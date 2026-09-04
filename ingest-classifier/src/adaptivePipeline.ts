import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { AuditStore } from "./audit.ts";
import {
  classifyWithLiveTaxonomy,
  type AdaptiveClassification,
} from "./adaptiveClassifier.ts";
import { CategoryStore, type CategoryProposal, type StoredCategory } from "./categories.ts";
import {
  DEFAULT_CATEGORY_DEDUP_THRESHOLD,
  resolveCategoryProposal,
} from "./categoryDedup.ts";
import { LocalHashEmbedding, type EmbeddingProvider } from "./embeddings.ts";
import { DocumentStore } from "./documents.ts";
import { CorrectionStore } from "./corrections.ts";
import { moveWithoutOverwrite, restoreMovedFile } from "./fileMover.ts";
import { parseMarkdownFile } from "./markdown.ts";
import type { ModelClient } from "./providers/types.ts";
import { ensureLibraryLayout, getLibraryPaths, type LibraryPaths } from "./taxonomy.ts";

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
  private categoryMutationTail: Promise<void> = Promise.resolve();

  constructor(options: AdaptivePipelineOptions) {
    this.paths = getLibraryPaths(options.root);
    this.client = options.client;
    this.embeddingProvider = options.embeddingProvider ?? new LocalHashEmbedding();
    this.dedupThreshold = options.dedupThreshold ?? DEFAULT_CATEGORY_DEDUP_THRESHOLD;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.audit = new AuditStore(this.paths.database);
    this.categories = new CategoryStore(this.paths.database, this.paths.root);
    this.documents = new DocumentStore(this.paths.database);
    this.corrections = new CorrectionStore(this.paths.database);
    this.examples = options.examples ?? (() => this.corrections.toPromptExamples());
  }

  async initialize(): Promise<void> {
    await ensureLibraryLayout(this.paths.root);
    await this.categories.initialize();
    await this.categories.ensureEmbeddings(this.embeddingProvider);
  }

  close(): void {
    this.corrections.close();
    this.documents.close();
    this.categories.close();
    this.audit.close();
  }

  async scanOnce(): Promise<AdaptiveProcessResult[]> {
    await this.initialize();
    const entries = await readdir(this.paths.inbox, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) => this.processDetectedPath(path.join(this.paths.inbox, entry.name))),
    );
  }

  async watch(signal?: AbortSignal): Promise<void> {
    await this.scanOnce();
    while (!signal?.aborted) {
      await waitFor(this.pollIntervalMs, signal);
      if (!signal?.aborted) await this.scanOnce();
    }
  }

  private async processDetectedPath(sourcePath: string): Promise<AdaptiveProcessResult> {
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
        return { status: "skipped", sourcePath, reason: "non-Markdown file" };
      }
      return await this.processMarkdown(sourcePath);
    } finally {
      this.inFlight.delete(sourcePath);
    }
  }

  private async processMarkdown(sourcePath: string): Promise<AdaptiveProcessResult> {
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
        return { status: "skipped", sourcePath, reason: "already audited or processing" };
      }
      this.audit.recordEvent(auditId, "parse", "ok", `${parsed.cleanText.length} characters`);

      stage = "classify";
      const classification = await classifyWithLiveTaxonomy(
        this.client,
        parsed.cleanText,
        this.categories.list(),
        { examples: this.examples() },
      );
      const resolution =
        classification.action === "existing"
          ? {
              category: this.requireCategory(classification.category),
              categoryAction: "existing" as const,
            }
          : await this.resolveProposal(classification.proposal);
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
        documentEmbedding = await this.embeddingProvider.embed(parsed.cleanText);
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
          embeddingProvider: documentEmbedding ? this.embeddingProvider.id : null,
          embeddingError,
        });
        this.audit.recordEvent(auditId, "move", "ok");
        this.audit.complete(auditId);
      } catch (error) {
        this.documents.deleteByAuditId(auditId);
        await restoreMovedFile(moved.destinationPath, sourcePath);
        throw error;
      }
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
      return { status: "failed", sourcePath, error: message };
    }
  }

  private requireCategory(id: string): StoredCategory {
    const category = this.categories.get(id);
    if (!category) throw new Error(`live category ${id} no longer exists`);
    return category;
  }

  private async resolveProposal(
    proposal: CategoryProposal,
  ): Promise<{ category: StoredCategory; categoryAction: "merged" | "created" }> {
    const previous = this.categoryMutationTail;
    let release!: () => void;
    this.categoryMutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await this.categories.ensureEmbeddings(this.embeddingProvider);
      const resolution = await resolveCategoryProposal(
        proposal,
        this.categories.list(),
        this.embeddingProvider,
        this.dedupThreshold,
      );
      if (resolution.action === "merge") {
        return { category: resolution.category, categoryAction: "merged" };
      }
      const category = await this.categories.create(
        proposal,
        resolution.embedding,
        this.embeddingProvider.id,
      );
      return { category, categoryAction: "created" };
    } finally {
      release();
    }
  }
}

async function waitFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
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
