/**
 * The operations both entry points share: the CLI and the MCP server call
 * these, never the pipeline directly.
 *
 * Every public method validates its input, runs the work, validates the output
 * and returns an {@link OperationResult} rather than throwing — a supervisor
 * inspects results, it does not catch exceptions across the boundary
 * (DEC-016, DEC-017).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ModelClient } from "../providers/types.ts";
import { AdaptiveIngestPipeline } from "../pipelines/adaptive-pipeline.ts";
import { AuditStore } from "../storage/audit.ts";
import {
  DocumentStore,
  backfillDocumentEmbeddings,
} from "../storage/documents.ts";
import { CorrectionStore } from "../storage/corrections.ts";
import {
  LocalHashEmbedding,
  type EmbeddingProvider,
} from "../search/embeddings.ts";
import { answerQuestion, retrieveDocuments } from "../search/retrieval.ts";
import { runClusteringJob } from "../search/clustering.ts";
import { getLibraryPaths } from "../taxonomy/taxonomy.ts";
import { acquireIngestionLock } from "./ingestion-lock.ts";
import {
  OperationFailure,
  type OperationResult,
  type IngestReport,
  type SearchReport,
  type AnswerReport,
  type CorrectionRecord,
  type ClusteringReport,
  type EmbeddingBackfillReport,
  emptyInputSchema,
  questionInputSchema,
  correctionInputSchema,
  clusterInputSchema,
  ingestReportSchema,
  searchReportSchema,
  answerSchema,
  correctionSchema,
  clusteringReportSchema,
  backfillReportSchema,
  success,
  failure,
  batchResult,
} from "./contracts.ts";

/**
 * How one agent instance is wired.
 *
 * `model` supplies a client directly; `createModel` defers construction until
 * an operation actually needs one, so read-only tools work without provider
 * credentials configured.
 */
export type IngestAgentOptions = {
  root: string;
  model?: ModelClient;
  createModel?: () => ModelClient;
  embeddingProvider?: EmbeddingProvider;
  dedupThreshold?: number;
  pollIntervalMs?: number;
};

/** Anything the agent owns and must close, in reverse order of creation. */
type Closable = { close(): void };

/** The three terminal states one inbox file can reach. */
type ProcessStatus = "ok" | "failed" | "skipped";

export class IngestAgent {
  readonly root: string;
  private readonly embedding: EmbeddingProvider;
  private readonly active = new Set<Promise<unknown>>();
  private readonly stop = new AbortController();
  private closing = false;
  private model?: ModelClient;

  constructor(private readonly options: IngestAgentOptions) {
    this.root = path.resolve(z.string().trim().min(1).parse(options.root));
    this.embedding = options.embeddingProvider ?? new LocalHashEmbedding();
    this.model = options.model;
    if (options.dedupThreshold !== undefined) {
      z.number().min(-1).max(1).parse(options.dedupThreshold);
    }
    if (options.pollIntervalMs !== undefined) {
      z.number().int().positive().parse(options.pollIntervalMs);
    }
  }

  /**
   * Classify and file one batch from the inbox.
   *
   * Holds the ingestion lock for the run, so a competing call gets
   * `LIBRARY_BUSY` rather than interleaving file moves (DEC-018).
   */
  ingestInbox(input: unknown = {}): Promise<OperationResult<IngestReport>> {
    return this.perform(
      emptyInputSchema,
      ingestReportSchema,
      input,
      async () => {
        const release = await acquireIngestionLock(this.root);
        try {
          const pipeline = this.pipeline();
          try {
            const results = await pipeline.scanOnce();
            const countByStatus = (status: ProcessStatus): number =>
              results.filter((result) => result.status === status).length;
            const counts = {
              total: results.length,
              succeeded: countByStatus("ok"),
              failed: countByStatus("failed"),
              skipped: countByStatus("skipped"),
            };
            return batchResult(
              { results, counts },
              counts.succeeded,
              counts.failed,
            );
          } finally {
            pipeline.close();
          }
        } finally {
          await release();
        }
      },
    );
  }

  /** Rank stored vectors against a question. No model call, no writes. */
  searchDocuments(input: unknown): Promise<OperationResult<SearchReport>> {
    return this.perform(
      questionInputSchema,
      searchReportSchema,
      input,
      async (args) =>
        this.withDocuments(async (documents) => {
          const hits = await retrieveDocuments({
            ...args,
            documents,
            embeddingProvider: this.embedding,
          });
          return success({
            sources: hits.map(({ document, score, snippet }) => ({
              path: document.destinationPath,
              summary: document.summary,
              score,
              snippet,
            })),
          });
        }),
    );
  }

  /** Answer from retrieved excerpts, with citations. Needs a model client. */
  askQuestion(input: unknown): Promise<OperationResult<AnswerReport>> {
    return this.perform(
      questionInputSchema,
      answerSchema,
      input,
      async (args) => {
        const model = this.getModel();
        return this.withDocuments(async (documents) =>
          success(
            await answerQuestion({
              ...args,
              documents,
              embeddingProvider: this.embedding,
              model,
            }),
          ),
        );
      },
    );
  }

  /** Store feedback for future prompts. Never moves or reclassifies a file. */
  recordCorrection(input: unknown): Promise<OperationResult<CorrectionRecord>> {
    return this.perform(
      correctionInputSchema,
      correctionSchema,
      input,
      async (args) =>
        this.withResources(async (use) => {
          const store = use(
            new CorrectionStore(getLibraryPaths(this.root).database),
          );
          return success(store.record(args));
        }),
    );
  }

  /** Report categories holding two themes. Suggestion only (DEC-011). */
  suggestCategorySplits(
    input: unknown = {},
  ): Promise<OperationResult<ClusteringReport>> {
    return this.perform(
      clusterInputSchema,
      clusteringReportSchema,
      input,
      async (args) =>
        this.withDocuments(async (documents) =>
          success(await runClusteringJob({ ...args, documents })),
        ),
    );
  }

  /** Repair missing document embeddings. Idempotent; safe to re-run. */
  backfillEmbeddings(
    input: unknown = {},
  ): Promise<OperationResult<EmbeddingBackfillReport>> {
    return this.perform(
      emptyInputSchema,
      backfillReportSchema,
      input,
      async () =>
        this.withResources(async (use) => {
          await mkdir(this.root, { recursive: true });
          const database = getLibraryPaths(this.root).database;
          const audit = use(new AuditStore(database));
          const documents = use(new DocumentStore(database));
          const report = await backfillDocumentEmbeddings({
            audit,
            documents,
            embeddingProvider: this.embedding,
          });
          return batchResult(
            report,
            report.examined - report.failed,
            report.failed,
          );
        }),
    );
  }

  // Watch is a standalone lifecycle operation, never an MCP tool.
  watch(signal?: AbortSignal): Promise<OperationResult<null>> {
    return this.perform(emptyInputSchema, z.null(), {}, async () => {
      const combined = signal
        ? AbortSignal.any([signal, this.stop.signal])
        : this.stop.signal;
      if (combined.aborted) return success(null);
      const release = await acquireIngestionLock(this.root);
      try {
        if (combined.aborted) return success(null);
        const pipeline = this.pipeline();
        try {
          await pipeline.watch(combined);
          return success(null);
        } finally {
          pipeline.close();
        }
      } finally {
        await release();
      }
    });
  }

  /** Stop accepting work and wait for in-flight operations to settle. */
  async close(): Promise<void> {
    this.closing = true;
    this.stop.abort();
    await Promise.allSettled([...this.active]);
  }

  private getModel(): ModelClient {
    if (this.model) return this.model;
    try {
      if (!this.options.createModel)
        throw new Error("Configure a model client for this operation.");
      this.model = this.options.createModel();
      return this.model;
    } catch (error) {
      throw new OperationFailure(
        "MODEL_CONFIGURATION",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private pipeline(): AdaptiveIngestPipeline {
    return new AdaptiveIngestPipeline({
      root: this.root,
      client: this.getModel(),
      embeddingProvider: this.embedding,
      dedupThreshold: this.options.dedupThreshold,
      pollIntervalMs: this.options.pollIntervalMs,
    });
  }

  private async withResources<T>(
    work: (use: <S extends Closable>(resource: S) => S) => Promise<T>,
  ): Promise<T> {
    const resources: Closable[] = [];
    let result!: T;
    let failed = false;
    let operationError: unknown;
    try {
      result = await work((resource) => {
        resources.push(resource);
        return resource;
      });
    } catch (error) {
      failed = true;
      operationError = error;
    }
    const cleanupErrors: unknown[] = [];
    for (const resource of resources.reverse()) {
      try {
        resource.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    // Preserve the primary failure after attempting every resource cleanup.
    if (failed) throw operationError;
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "Resource cleanup failed");
    }
    return result;
  }

  private withDocuments<T>(
    work: (documents: DocumentStore) => Promise<T>,
  ): Promise<T> {
    return this.withResources(async (use) => {
      await mkdir(this.root, { recursive: true });
      const database = getLibraryPaths(this.root).database;
      use(new AuditStore(database));
      return work(use(new DocumentStore(database)));
    });
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
        // Only the all-failed batch reaches here with `error` status and data.
        if (result.data === null) return result;
        const output = outputSchema.safeParse(result.data);
        if (!output.success)
          return failure(
            "INVALID_OUTPUT",
            `Operation returned invalid data: ${output.error.message}`,
          );
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

/** Construct an agent. Preferred over `new` so callers depend on the type. */
export function createIngestAgent(options: IngestAgentOptions): IngestAgent {
  return new IngestAgent(options);
}
