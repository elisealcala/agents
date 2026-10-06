/** Bounded project-evidence operations, preserving the independent classifier (DEC-028). */
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  failure,
  success,
  OperationFailure,
  type OperationResult,
} from "../application/contracts.ts";
import { acquireIngestionLock } from "../application/ingestion-lock.ts";
import { markdownToText } from "../files/markdown.ts";
import { restoreMovedFile } from "../files/file-mover.ts";
import { AdaptiveIngestPipeline } from "../pipelines/adaptive-pipeline.ts";
import type { ModelClient } from "../providers/types.ts";
import {
  cosineSimilarity,
  LocalHashEmbedding,
  type EmbeddingProvider,
} from "../search/embeddings.ts";
import { DEFAULT_MINIMUM_SCORE, DEFAULT_TOP_K } from "../search/retrieval.ts";
import { AuditStore, isCompletedAuditRecord } from "../storage/audit.ts";
import { DocumentStore, type StoredDocument } from "../storage/documents.ts";
import { getLibraryPaths } from "../taxonomy/taxonomy.ts";
import type { TraceObserver } from "../observability/trace.ts";
import {
  evidenceIngestInputSchema,
  evidenceReadInputSchema,
  evidenceSearchInputSchema,
  evidenceReceiptSchema,
  evidenceSnapshotSchema,
  evidenceSearchResultSchema,
  type EvidenceReceipt,
  type EvidenceSnapshot,
  type EvidenceSearchResult,
  type EvidenceRef,
} from "./contracts.ts";
import {
  EvidenceStore,
  hashMarkdown,
  type EvidenceRecord,
  type StoredEvidenceChunk,
} from "./store.ts";

export type EvidenceAgentOptions = {
  root: string;
  model?: ModelClient;
  createModel?: () => ModelClient;
  embeddingProvider?: EmbeddingProvider;
  dedupThreshold?: number;
  fitThreshold?: number;
  promptTemplate?: string;
  exampleLimit?: number;
  trace?: { observer: TraceObserver; parentId: string | null };
};

type Stores = {
  evidence: EvidenceStore;
  audit: AuditStore;
  documents: DocumentStore;
};

export class EvidenceAgent {
  readonly root: string;
  private readonly embedding: EmbeddingProvider;
  private readonly active = new Set<Promise<unknown>>();
  private closing = false;

  constructor(private readonly options: EvidenceAgentOptions) {
    this.root = path.resolve(z.string().trim().min(1).parse(options.root));
    this.embedding = options.embeddingProvider ?? new LocalHashEmbedding();
  }

  /** Snapshot storage is committed before model construction, classification or indexing. */
  ingest(input: unknown): Promise<OperationResult<EvidenceReceipt>> {
    return this.perform(
      evidenceIngestInputSchema,
      evidenceReceiptSchema,
      input,
      async (args) =>
        this.withLock(async () =>
          this.withStores(async (stores) => {
            const record = stores.evidence.register(args);
            return this.index(record, stores);
          }),
        ),
    );
  }

  /** A stable reference reads the immutable snapshot, even when indexing failed. */
  read(input: unknown): Promise<OperationResult<EvidenceSnapshot>> {
    return this.perform(
      evidenceReadInputSchema,
      evidenceSnapshotSchema,
      input,
      async (args) =>
        this.withStores(async ({ evidence }) => {
          const record = this.requireRecord(
            evidence,
            args.projectId,
            args.documentRef,
          );
          this.assertSnapshot(record);
          return success({
            ...reference(record),
            markdown: record.markdown,
            sourceDate: record.sourceDate,
          });
        }),
    );
  }

  /** Project SQL filtering precedes provider checks, scoring, sorting and truncation. */
  search(input: unknown): Promise<OperationResult<EvidenceSearchResult>> {
    return this.perform(
      evidenceSearchInputSchema,
      evidenceSearchResultSchema,
      input,
      async (args) =>
        this.withStores(async ({ evidence, audit, documents }) => {
          const records = evidence.list(args.projectId);
          const completed = new Set(
            audit
              .list("ok")
              .filter(isCompletedAuditRecord)
              .map((item) => item.id),
          );
          const chunks = evidence.chunks(args.projectId);
          const readyReferences = new Set(
            records
              .filter(
                (record) =>
                  record.auditId !== null &&
                  completed.has(record.auditId) &&
                  this.ready(documents.getByAuditId(record.auditId)),
              )
              .map((record) => record.documentRef),
          );
          const missingEmbeddings = records.filter((record) => {
            const sourceChunks = chunks.filter(
              (chunk) => chunk.record.documentRef === record.documentRef,
            );
            return (
              !readyReferences.has(record.documentRef) ||
              sourceChunks.length === 0 ||
              sourceChunks.some((chunk) => !this.readyChunk(chunk))
            );
          }).length;
          const query = await this.embedding.embed(args.question);
          this.assertVector(query);
          const passages = chunks
            .flatMap((chunk) => {
              const record = chunk.record;
              if (
                !readyReferences.has(record.documentRef) ||
                !this.readyChunk(chunk) ||
                !chunk.embedding
              )
                return [];
              this.assertSnapshot(record);
              const score = cosineSimilarity(query, chunk.embedding);
              if (score < (args.minimumScore ?? DEFAULT_MINIMUM_SCORE))
                return [];
              return [
                {
                  ...reference(record),
                  start: chunk.start,
                  end: chunk.end,
                  quote: record.markdown.slice(chunk.start, chunk.end),
                  score,
                },
              ];
            })
            .sort(
              (left, right) =>
                right.score - left.score ||
                left.documentRef.localeCompare(right.documentRef) ||
                left.start - right.start,
            )
            .slice(0, args.topK ?? DEFAULT_TOP_K);
          return success({ passages, missingEmbeddings });
        }),
    );
  }

  /** Retry only this reference; repair vectors from the snapshot, never a taxonomy file. */
  retryIndex(input: unknown): Promise<OperationResult<EvidenceReceipt>> {
    return this.perform(
      evidenceReadInputSchema,
      evidenceReceiptSchema,
      input,
      async (args) =>
        this.withLock(async () =>
          this.withStores(async (stores) =>
            this.index(
              this.requireRecord(
                stores.evidence,
                args.projectId,
                args.documentRef,
              ),
              stores,
            ),
          ),
        ),
    );
  }

  /** Drain active operations before disposing this application boundary. */
  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.active]);
  }

  private async index(
    record: EvidenceRecord,
    stores: Stores,
  ): Promise<OperationResult<EvidenceReceipt>> {
    try {
      this.assertSnapshot(record);
      const sourcePath = path.join(
        getLibraryPaths(this.root).inbox,
        `${record.documentRef}.md`,
      );
      let document = await this.recoverDocument(record, sourcePath, stores);
      if (!document) {
        await mkdir(path.dirname(sourcePath), { recursive: true });
        await writeFile(sourcePath, record.markdown, {
          encoding: "utf8",
          flag: "w",
        });
        const pipeline = new AdaptiveIngestPipeline({
          root: this.root,
          client: this.getModel(),
          embeddingProvider: this.embedding,
          dedupThreshold: this.options.dedupThreshold,
          fitThreshold: this.options.fitThreshold,
          promptTemplate: this.options.promptTemplate,
          exampleLimit: this.options.exampleLimit,
          trace: this.options.trace,
        });
        try {
          const result = await pipeline.ingestFile(sourcePath);
          if (result.status !== "ok") {
            throw new Error(
              result.status === "failed" ? result.error : result.reason,
            );
          }
        } finally {
          pipeline.close();
        }
        document = await this.recoverDocument(record, sourcePath, stores);
        if (!document)
          throw new Error("Classified evidence has no completed document.");
      }
      if (!this.ready(document)) {
        const embedding = await this.embedding.embed(
          markdownToText(record.markdown),
        );
        this.assertVector(embedding);
        stores.documents.upsert({
          ...document,
          cleanText: markdownToText(record.markdown),
          embedding,
          embeddingProvider: this.embedding.id,
          embeddingError: null,
        });
      }
      stores.evidence.ensureChunks(record);
      for (const chunk of stores.evidence.chunks(
        record.projectId,
        record.documentRef,
      )) {
        if (this.readyChunk(chunk)) continue;
        const embedding = await this.embedding.embed(
          markdownToText(record.markdown.slice(chunk.start, chunk.end)),
        );
        this.assertVector(embedding);
        stores.evidence.setChunkEmbedding(
          record.documentRef,
          chunk.start,
          embedding,
          this.embedding.id,
        );
      }
      stores.evidence.recordError(record.documentRef, null);
      return success({
        ...reference(record),
        storageStatus: "stored",
        indexStatus: "ready",
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stores.evidence.recordError(record.documentRef, message);
      return {
        status: "partial",
        data: {
          ...reference(record),
          storageStatus: "stored",
          indexStatus: "missing",
          error: message,
        },
        error: { code: "INCOMPLETE", message },
      };
    }
  }

  /** Reconcile a crash after filing but before the evidence association was saved. */
  private async recoverDocument(
    record: EvidenceRecord,
    sourcePath: string,
    stores: Stores,
  ): Promise<StoredDocument | null> {
    const audit = stores.audit
      .list()
      .find(
        (item) =>
          item.sourcePath === sourcePath &&
          item.sourceSha256 === record.checksum,
      );
    if (!audit) return null;
    const document = stores.documents.getByAuditId(audit.id);
    if (isCompletedAuditRecord(audit)) {
      const restored =
        document ??
        stores.documents.upsert({
          auditId: audit.id,
          sourcePath,
          destinationPath: audit.destinationPath,
          categoryId: audit.category,
          summary: audit.summary,
          cleanText: markdownToText(record.markdown),
          embedding: null,
          embeddingProvider: null,
          embeddingError: "Missing document vector is being repaired.",
        });
      stores.evidence.link(record.documentRef, audit.id);
      return restored;
    }
    if (audit.status !== "processing" && audit.status !== "failed") return null;
    // The exclusive library lock proves that this targeted processing row is abandoned.
    if (audit.destinationPath) {
      const content = await readFile(audit.destinationPath, "utf8").catch(
        (error: unknown) => {
          if (isMissingFile(error)) return null;
          throw error;
        },
      );
      if (content !== null) {
        if (hashMarkdown(content) !== record.checksum) {
          throw new Error(
            "Interrupted destination differs from immutable evidence.",
          );
        }
        if (
          document &&
          audit.category &&
          audit.summary &&
          audit.confidence !== null
        ) {
          stores.audit.complete(audit.id);
          stores.evidence.link(record.documentRef, audit.id);
          return document;
        }
        // Avoid suffix copies if a process stopped after the verified move.
        await unlink(sourcePath).catch((error: unknown) => {
          if (!isMissingFile(error)) throw error;
        });
        await restoreMovedFile(audit.destinationPath, sourcePath);
      }
    }
    stores.audit.fail({
      auditId: audit.id,
      sourcePath,
      sourceSha256: record.checksum,
      stage: "classify",
      error: "Interrupted targeted ingestion is being retried.",
    });
    return null;
  }

  private ready(document: StoredDocument | null): boolean {
    if (!document?.embedding) return false;
    return (
      document.embeddingStatus === "ready" &&
      document.embeddingProvider === this.embedding.id &&
      document.embedding.length === this.embedding.dimensions &&
      document.embedding.every(Number.isFinite)
    );
  }

  private readyChunk(chunk: StoredEvidenceChunk): boolean {
    return (
      chunk.embedding !== null &&
      chunk.embeddingProvider === this.embedding.id &&
      chunk.embedding.length === this.embedding.dimensions &&
      chunk.embedding.every(Number.isFinite)
    );
  }

  private assertVector(vector: number[]): void {
    if (
      vector.length !== this.embedding.dimensions ||
      !vector.every(Number.isFinite)
    ) {
      throw new Error("Embedding provider returned an invalid vector.");
    }
  }

  private assertSnapshot(record: EvidenceRecord): void {
    if (hashMarkdown(record.markdown) !== record.checksum) {
      throw new Error("Immutable evidence checksum verification failed.");
    }
  }

  private requireRecord(
    store: EvidenceStore,
    projectId: string,
    documentRef: string,
  ): EvidenceRecord {
    const record = store.get(projectId, documentRef);
    if (!record)
      throw new OperationFailure(
        "INVALID_INPUT",
        "Evidence reference is not associated with the selected project.",
      );
    return record;
  }

  private getModel(): ModelClient {
    if (this.options.model) return this.options.model;
    try {
      if (this.options.createModel) return this.options.createModel();
      throw new Error("Configure a model client for targeted classification.");
    } catch (error) {
      throw new OperationFailure(
        "MODEL_CONFIGURATION",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const release = await acquireIngestionLock(this.root);
    try {
      return await work();
    } finally {
      await release();
    }
  }

  private async withStores<T>(
    work: (stores: Stores) => Promise<T>,
  ): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const resources: Array<{ close(): void }> = [];
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      const database = getLibraryPaths(this.root).database;
      const audit = new AuditStore(database);
      resources.push(audit);
      const documents = new DocumentStore(database);
      resources.push(documents);
      const evidence = new EvidenceStore(database);
      resources.push(evidence);
      outcome = { ok: true, value: await work({ audit, documents, evidence }) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    const errors: unknown[] = [];
    for (const resource of resources.reverse()) {
      try {
        resource.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (!outcome.ok) {
      if (errors.length)
        throw new AggregateError(
          [outcome.error, ...errors],
          "Evidence operation and cleanup failed",
        );
      throw outcome.error;
    }
    if (errors.length)
      throw new AggregateError(errors, "Evidence cleanup failed");
    return outcome.value;
  }

  private perform<I, O>(
    inputSchema: z.ZodType<I>,
    outputSchema: z.ZodType<O>,
    input: unknown,
    work: (args: I) => Promise<OperationResult<O>>,
  ): Promise<OperationResult<O>> {
    if (this.closing)
      return Promise.resolve(
        failure("APPLICATION_CLOSED", "The classifier is shutting down."),
      );
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success)
      return Promise.resolve(failure("INVALID_INPUT", parsed.error.message));
    const task = (async (): Promise<OperationResult<O>> => {
      try {
        const result = await work(parsed.data);
        if (result.data === null) return result;
        const output = outputSchema.safeParse(result.data);
        if (!output.success)
          return failure("INVALID_OUTPUT", output.error.message);
        if (result.status === "success") return success(output.data);
        return {
          status: result.status,
          data: output.data,
          error: result.error,
        };
      } catch (error) {
        return failure(
          error instanceof OperationFailure ? error.code : "OPERATION_FAILED",
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
    this.active.add(task);
    void task.then(() => this.active.delete(task));
    return task;
  }
}

/** Independent worker entry point for evaluators and in-process supervisors. */
export function createEvidenceAgent(
  options: EvidenceAgentOptions,
): EvidenceAgent {
  return new EvidenceAgent(options);
}

function reference(record: EvidenceRecord): EvidenceRef {
  return {
    documentRef: record.documentRef,
    projectId: record.projectId,
    sourceId: record.sourceId,
    sourceVersion: record.sourceVersion,
    checksum: record.checksum,
  };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
