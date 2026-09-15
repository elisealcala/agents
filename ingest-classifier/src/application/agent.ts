import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ModelClient } from "../providers/types.ts";
import { AdaptiveIngestPipeline } from "../pipelines/adaptivePipeline.ts";
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
import { acquireIngestionLock } from "./ingestionLock.ts";
import {
  OperationFailure,
  type OperationResult,
  type IngestReport,
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

export type IngestAgentOptions = {
  root: string;
  model?: ModelClient;
  createModel?: () => ModelClient;
  embeddingProvider?: EmbeddingProvider;
  dedupThreshold?: number;
  pollIntervalMs?: number;
};

type Closable = { close(): void };

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
            const counts = {
              total: results.length,
              succeeded: results.filter((result) => result.status === "ok")
                .length,
              failed: results.filter((result) => result.status === "failed")
                .length,
              skipped: results.filter((result) => result.status === "skipped")
                .length,
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

  searchDocuments(input: unknown) {
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

  askQuestion(input: unknown) {
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

  recordCorrection(input: unknown) {
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

  suggestCategorySplits(input: unknown = {}) {
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

  backfillEmbeddings(input: unknown = {}) {
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
        if (result.data !== null) {
          const output = outputSchema.safeParse(result.data);
          if (!output.success)
            return failure(
              "INVALID_OUTPUT",
              `Operation returned invalid data: ${output.error.message}`,
            );
          return { ...result, data: output.data };
        }
        return result;
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

export function createIngestAgent(options: IngestAgentOptions): IngestAgent {
  return new IngestAgent(options);
}
