/**
 * The production ingestion pipeline: the one `run` and `watch` use.
 *
 * For each inbox file it parses the Markdown, classifies against the live
 * taxonomy, resolves any proposed category against that parent's existing
 * children, files the note, and records an audit row and a document vector.
 * A file that fails at any step stays in the inbox with a failed audit row.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { AuditStore } from "../storage/audit.ts";
import {
  classifyWithLiveTaxonomy,
  type AdaptiveClassification,
} from "../classification/adaptive-classifier.ts";
import {
  CategoryStore,
  type CategoryProposal,
  type StoredCategory,
} from "../storage/categories.ts";
import {
  DEFAULT_CATEGORY_DEDUP_THRESHOLD,
  resolveCategoryProposal,
} from "../taxonomy/category-dedup.ts";
import {
  LocalHashEmbedding,
  type EmbeddingProvider,
} from "../search/embeddings.ts";
import { DocumentStore } from "../storage/documents.ts";
import { CorrectionStore } from "../storage/corrections.ts";
import { moveWithoutOverwrite, restoreMovedFile } from "../files/file-mover.ts";
import { DEFAULT_POLL_INTERVAL_MS, RECENT_FILING_LIMIT } from "../defaults.ts";
import { parseMarkdownFile } from "../files/markdown.ts";
import { retrieveDocuments } from "../search/retrieval.ts";
import type { RecentFiling, SimilarNote } from "../classification/organizer.ts";
import type { ModelClient } from "../providers/types.ts";
import { observeToolLoop, type TraceObserver } from "../observability/trace.ts";
import {
  ensureLibraryLayout,
  getLibraryPaths,
  type LibraryPaths,
} from "../taxonomy/taxonomy.ts";

/**
 * What happened to one inbox file.
 *
 * `categoryAction` distinguishes filing under an existing category, merging a
 * proposal into a near-duplicate sibling, and creating a new child.
 */
export type AdaptiveProcessResult =
  | {
      status: "ok";
      sourcePath: string;
      destinationPath: string;
      category: StoredCategory;
      classification: AdaptiveClassification;
      categoryAction: "existing" | "merged" | "created";
    }
  | { status: "failed"; sourcePath: string; error: string }
  | { status: "skipped"; sourcePath: string; reason: string };

export type AdaptivePipelineOptions = {
  root: string;
  client: ModelClient;
  embeddingProvider?: EmbeddingProvider;
  dedupThreshold?: number;
  pollIntervalMs?: number;
  examples?: () => string[];
  fitThreshold?: number;
  promptTemplate?: string;
  exampleLimit?: number;
  trace?: { observer: TraceObserver; parentId: string | null };
};

export class AdaptiveIngestPipeline {
  readonly paths: LibraryPaths;
  readonly audit: AuditStore;
  readonly categories: CategoryStore;
  readonly documents: DocumentStore;
  readonly corrections: CorrectionStore;
  readonly embeddingProvider: EmbeddingProvider;
  readonly dedupThreshold: number;
  private readonly client: ModelClient;
  private readonly inFlight = new Set<string>();
  private readonly pollIntervalMs: number;
  private readonly examples: () => string[];
  private readonly fitThreshold: number | undefined;
  private readonly promptTemplate: string | undefined;
  private readonly trace:
    | { observer: TraceObserver; parentId: string | null }
    | undefined;
  private categoryMutationTail: Promise<void> = Promise.resolve();

  constructor(options: AdaptivePipelineOptions) {
    this.paths = getLibraryPaths(options.root);
    this.client = options.client;
    this.embeddingProvider =
      options.embeddingProvider ?? new LocalHashEmbedding();
    this.dedupThreshold =
      options.dedupThreshold ?? DEFAULT_CATEGORY_DEDUP_THRESHOLD;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const opened: Array<{ close(): void }> = [];
    try {
      this.audit = new AuditStore(this.paths.database);
      opened.push(this.audit);
      this.categories = new CategoryStore(this.paths.database, this.paths.root);
      opened.push(this.categories);
      this.documents = new DocumentStore(this.paths.database);
      opened.push(this.documents);
      this.corrections = new CorrectionStore(this.paths.database);
    } catch (error) {
      for (const store of opened.reverse()) {
        try {
          store.close();
        } catch {
          /* Continue closing the other stores. */
        }
      }
      throw error;
    }
    this.examples =
      options.examples ??
      (() => this.corrections.toPromptExamples(options.exampleLimit));
    this.fitThreshold = options.fitThreshold;
    this.promptTemplate = options.promptTemplate;
    this.trace = options.trace;
  }

  async initialize(): Promise<void> {
    await ensureLibraryLayout(this.paths.root);
    await this.categories.initialize();
    await this.categories.ensureEmbeddings(this.embeddingProvider);
  }

  close(): void {
    const errors: unknown[] = [];
    for (const store of [
      this.corrections,
      this.documents,
      this.categories,
      this.audit,
    ]) {
      try {
        store.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Pipeline cleanup failed");
  }

  async scanOnce(): Promise<AdaptiveProcessResult[]> {
    await this.initialize();
    const entries = await readdir(this.paths.inbox, { withFileTypes: true });
    const sources = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(this.paths.inbox, entry.name));
    // Settle every file before callers close stores or release the ingestion lock.
    const results = await Promise.allSettled(
      sources.map((source) => this.processDetectedPath(source)),
    );
    return results.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            status: "failed" as const,
            sourcePath: sources[index]!,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          },
    );
  }

  async watch(signal?: AbortSignal): Promise<void> {
    await this.scanOnce();
    while (!signal?.aborted) {
      await waitFor(this.pollIntervalMs, signal);
      if (!signal?.aborted) await this.scanOnce();
    }
  }

  private async processDetectedPath(
    sourcePath: string,
  ): Promise<AdaptiveProcessResult> {
    if (this.inFlight.has(sourcePath)) {
      return { status: "skipped", sourcePath, reason: "already processing" };
    }
    this.inFlight.add(sourcePath);
    try {
      if (path.extname(sourcePath).toLowerCase() !== ".md") {
        const metadata = await stat(sourcePath);
        this.audit.skip(
          sourcePath,
          `stat:${metadata.size}:${metadata.mtimeMs}`,
          "non-Markdown file",
        );
        this.finishStage(
          this.trace?.parentId ?? null,
          "skip",
          "stage",
          { sourcePath },
          { status: "ok", output: { reason: "non-Markdown file" } },
        );
        return { status: "skipped", sourcePath, reason: "non-Markdown file" };
      }
      return await this.processMarkdown(sourcePath);
    } finally {
      this.inFlight.delete(sourcePath);
    }
  }

  private async processMarkdown(
    sourcePath: string,
  ): Promise<AdaptiveProcessResult> {
    const fileSpan = this.trace?.observer.start({
      parentId: this.trace.parentId,
      name: path.basename(sourcePath),
      kind: "stage",
      input: { sourcePath },
    });
    let classifySpan: string | undefined;
    let classifyOpen = false;
    let auditId: number | undefined;
    let sha256: string | undefined;
    let stage: "parse" | "classify" | "move" = "parse";
    try {
      const parsed = await parseMarkdownFile(sourcePath);
      sha256 = parsed.sha256;
      auditId =
        this.audit.begin({
          sourcePath,
          sourceSha256: parsed.sha256,
          provider: this.client.provider,
          model: this.client.model,
        }) ?? undefined;
      if (auditId === undefined) {
        this.endSpan(fileSpan, {
          status: "ok",
          output: { reason: "already audited or processing" },
        });
        return {
          status: "skipped",
          sourcePath,
          reason: "already audited or processing",
        };
      }
      this.finishStage(fileSpan ?? null, "parse", "stage", undefined, {
        status: "ok",
        output: { characters: parsed.cleanText.length },
      });
      this.audit.recordEvent(
        auditId,
        "parse",
        "ok",
        `${parsed.cleanText.length} characters`,
      );

      stage = "classify";
      classifySpan = this.trace?.observer.start({
        parentId: fileSpan ?? this.trace?.parentId ?? null,
        name: "classify",
        kind: "stage",
      });
      classifyOpen = classifySpan !== undefined;
      let classification: AdaptiveClassification;
      try {
        classification = await classifyWithLiveTaxonomy(
          this.client,
          parsed.cleanText,
          this.categories.list(),
          {
            examples: this.examples(),
            searchSimilar: () => this.findSimilarNotes(parsed.cleanText),
            listRecent: () => this.listRecentFilings(),
            fitThreshold: this.fitThreshold,
            promptTemplate: this.promptTemplate,
            observe:
              this.trace && classifySpan
                ? observeToolLoop(this.trace.observer, classifySpan)
                : undefined,
          },
        );
      } catch (error) {
        this.endSpan(classifySpan, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        classifyOpen = false;
        throw error;
      }
      const resolution =
        classification.action === "existing"
          ? {
              category: this.requireCategory(classification.category),
              categoryAction: "existing" as const,
            }
          : await this.resolveProposal(
              classification.proposal,
              classification.parent,
            );
      this.endSpan(classifySpan, {
        status: "ok",
        output: {
          categoryAction: resolution.categoryAction,
          categoryId: resolution.category.id,
        },
      });
      classifyOpen = false;
      this.audit.setClassification(auditId, {
        category: resolution.category.id,
        summary: classification.summary,
        tags: classification.tags,
        confidence_score: classification.confidence_score,
      });
      this.audit.recordEvent(
        auditId,
        "classify",
        "ok",
        `${resolution.categoryAction}:${resolution.category.id}`,
      );

      let documentEmbedding: number[] | null = null;
      let embeddingError: string | null = null;
      try {
        documentEmbedding = await this.embeddingProvider.embed(
          parsed.cleanText,
        );
      } catch (error) {
        embeddingError = error instanceof Error ? error.message : String(error);
      }

      stage = "move";
      const moved = await moveWithoutOverwrite(
        sourcePath,
        this.categories.folderPath(resolution.category),
        parsed.sha256,
      );
      try {
        this.audit.setDestination(auditId, moved.destinationPath);
        this.documents.upsert({
          auditId,
          sourcePath,
          destinationPath: moved.destinationPath,
          categoryId: resolution.category.id,
          summary: classification.summary,
          cleanText: parsed.cleanText,
          embedding: documentEmbedding,
          embeddingProvider: documentEmbedding
            ? this.embeddingProvider.id
            : null,
          embeddingError,
        });
        this.audit.recordEvent(auditId, "move", "ok");
        this.audit.complete(auditId);
      } catch (error) {
        this.documents.deleteByAuditId(auditId);
        await restoreMovedFile(moved.destinationPath, sourcePath);
        throw error;
      }
      this.finishStage(fileSpan ?? null, "move", "stage", undefined, {
        status: "ok",
        output: { destinationPath: moved.destinationPath },
      });
      this.endSpan(fileSpan, {
        status: "ok",
        output: { destinationPath: moved.destinationPath },
      });
      return {
        status: "ok",
        sourcePath,
        destinationPath: moved.destinationPath,
        category: resolution.category,
        classification,
        categoryAction: resolution.categoryAction,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.audit.fail({
        auditId,
        sourcePath,
        sourceSha256: sha256,
        provider: this.client.provider,
        model: this.client.model,
        stage,
        error: message,
      });
      if (classifyOpen) {
        this.endSpan(classifySpan, { status: "failed", error: message });
      }
      this.endSpan(fileSpan, { status: "failed", error: message });
      return { status: "failed", sourcePath, error: message };
    }
  }

  /** Open a stage span and close it at once when a trace is attached. */
  private finishStage(
    parentId: string | null,
    name: string,
    kind: "stage",
    input: unknown,
    result: { status: "ok" | "failed"; output?: unknown; error?: string },
  ): void {
    if (!this.trace) return;
    const id = this.trace.observer.start({
      parentId,
      name,
      kind,
      input,
    });
    this.trace.observer.end(id, result);
  }

  private endSpan(
    id: string | undefined,
    result: { status: "ok" | "failed"; output?: unknown; error?: string },
  ): void {
    if (!this.trace || !id) return;
    this.trace.observer.end(id, result);
  }

  /** Similar notes already on disk. The query is this note, not a model-written string. */
  /** Latest filed notes. The organizer sees habits; similarity still decides the fit. */
  private listRecentFilings(): RecentFiling[] {
    return this.documents.listRecent(RECENT_FILING_LIMIT).map((document) => ({
      path: document.destinationPath,
      categoryId: document.categoryId,
      summary: document.summary,
      filedAt: document.createdAt,
    }));
  }

  private async findSimilarNotes(cleanText: string): Promise<SimilarNote[]> {
    const hits = await retrieveDocuments({
      question: cleanText,
      documents: this.documents,
      embeddingProvider: this.embeddingProvider,
    });
    return hits.map(({ document, snippet }) => ({
      path: document.destinationPath,
      categoryId: document.categoryId,
      summary: document.summary,
      snippet,
    }));
  }

  private requireCategory(id: string): StoredCategory {
    const category = this.categories.get(id);
    if (!category) throw new Error(`live category ${id} no longer exists`);
    return category;
  }

  /**
   * Turn a proposed category into a real one, serialized against every other
   * proposal in this run.
   *
   * Files are classified concurrently, so two notes can propose the same new
   * category at almost the same moment. Without serialization both would look
   * up the parent's children, both would find no match, and both would create
   * a folder — the duplicate the dedup threshold exists to prevent (DEC-009).
   *
   * `categoryMutationTail` is a promise chain acting as a mutex: each caller
   * captures the previous tail, installs its own unresolved promise as the new
   * tail, then waits for the one it captured. Releasing in `finally` lets the
   * next caller proceed even if this one throws.
   */
  private async resolveProposal(
    proposal: CategoryProposal,
    parentId: string,
  ): Promise<{
    category: StoredCategory;
    categoryAction: "merged" | "created";
  }> {
    const previousMutation = this.categoryMutationTail;
    let release!: () => void;
    this.categoryMutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousMutation;
    try {
      await this.categories.ensureEmbeddings(this.embeddingProvider);
      const resolution = await resolveCategoryProposal(
        proposal,
        this.categories.children(parentId),
        this.embeddingProvider,
        this.dedupThreshold,
        parentId,
      );
      if (resolution.action === "merge") {
        return { category: resolution.category, categoryAction: "merged" };
      }
      const category = await this.categories.create(
        proposal,
        resolution.embedding,
        this.embeddingProvider.id,
        parentId,
      );
      return { category, categoryAction: "created" };
    } finally {
      release();
    }
  }
}

async function waitFor(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
