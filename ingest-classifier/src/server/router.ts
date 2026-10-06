/**
 * The studio's tRPC router.
 *
 * Procedures are the six application operations, plus config, corrections, and
 * library memory. Organizer tools are not procedures: they arrive as spans on
 * `runs.follow`.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { createIngestAgent } from "../application/agent.ts";
import {
  clusterInputSchema,
  correctionInputSchema,
  emptyInputSchema,
  questionInputSchema,
  type OperationResult,
} from "../application/contracts.ts";
import {
  assertOrganizerTemplate,
  DEFAULT_ADAPTIVE_ORGANIZER_TEMPLATE,
} from "../classification/organizer.ts";
import { EXISTING_CATEGORY_FIT_THRESHOLD } from "../classification/adaptive-classifier.ts";
import type { ModelClient } from "../providers/types.ts";
import { AuditStore } from "../storage/audit.ts";
import { CategoryStore } from "../storage/categories.ts";
import {
  CorrectionStore,
  DEFAULT_CORRECTION_EXAMPLE_LIMIT,
} from "../storage/corrections.ts";
import { DocumentStore } from "../storage/documents.ts";
import type { StudioStore, StudioRun, StudioSpan } from "../storage/studio.ts";
import { DEFAULT_CATEGORY_DEDUP_THRESHOLD } from "../taxonomy/category-dedup.ts";
import { getLibraryPaths } from "../taxonomy/taxonomy.ts";
import { createEvidenceAgent, type EvidenceAgent } from "../evidence/agent.ts";
import {
  evidenceIngestInputSchema,
  evidenceReadInputSchema,
  evidenceSearchInputSchema,
} from "../evidence/contracts.ts";

/** How often the SSE stream pings so a quiet run is not treated as dead. */
const SSE_PING_MS = 15_000;

/** How long the browser waits for a ping before reconnecting. */
const SSE_RECONNECT_MS = 20_000;

/** What one studio process shares across requests. */
export type StudioContext = {
  root: string;
  store: StudioStore;
  createModel: () => ModelClient;
  envDedupThreshold?: number;
};

const t = initTRPC.context<StudioContext>().create({
  sse: {
    ping: { enabled: true, intervalMs: SSE_PING_MS },
    client: { reconnectAfterInactivityMs: SSE_RECONNECT_MS },
  },
});

const settingsInput = z.object({
  fitThreshold: z.number().gt(0).lte(1),
  dedupThreshold: z.number().min(-1).max(1),
  exampleLimit: z.number().int().nonnegative(),
  promptTemplate: z.string().min(1),
});

const runInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ingest_inbox"),
    input: emptyInputSchema.optional(),
  }),
  z.object({
    action: z.literal("search_documents"),
    input: questionInputSchema,
  }),
  z.object({ action: z.literal("ask_question"), input: questionInputSchema }),
  z.object({
    action: z.literal("suggest_category_splits"),
    input: clusterInputSchema.optional(),
  }),
  z.object({
    action: z.literal("record_correction"),
    input: correctionInputSchema,
  }),
  z.object({
    action: z.literal("backfill_embeddings"),
    input: emptyInputSchema.optional(),
  }),
]);

const followInput = z.object({
  runId: z.string().min(1),
  lastEventId: z.string().nullish(),
});

export const appRouter = t.router({
  evidence: t.router({
    ingest: t.procedure
      .input(evidenceIngestInputSchema)
      .mutation(({ ctx, input }) =>
        withEvidence(ctx, (agent) => agent.ingest(input)),
      ),
    read: t.procedure
      .input(evidenceReadInputSchema)
      .query(({ ctx, input }) =>
        withEvidence(ctx, (agent) => agent.read(input)),
      ),
    search: t.procedure
      .input(evidenceSearchInputSchema)
      .query(({ ctx, input }) =>
        withEvidence(ctx, (agent) => agent.search(input)),
      ),
    retryIndex: t.procedure
      .input(evidenceReadInputSchema)
      .mutation(({ ctx, input }) =>
        withEvidence(ctx, (agent) => agent.retryIndex(input)),
      ),
  }),
  agent: t.router({
    identity: t.procedure.query(({ ctx }) => {
      let model: { provider: string; model: string } | null = null;
      try {
        const client = ctx.createModel();
        model = { provider: client.provider, model: client.model };
      } catch {
        model = null;
      }
      return {
        id: "ingest-classifier",
        name: "Ingest classifier",
        root: ctx.root,
        model,
      };
    }),
  }),
  config: t.router({
    get: t.procedure.query(({ ctx }) => effectiveConfig(ctx)),
    update: t.procedure.input(settingsInput).mutation(({ ctx, input }) => {
      try {
        assertOrganizerTemplate(input.promptTemplate);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      ctx.store.writeSetting("fitThreshold", input.fitThreshold);
      ctx.store.writeSetting("dedupThreshold", input.dedupThreshold);
      ctx.store.writeSetting("exampleLimit", input.exampleLimit);
      ctx.store.writeSetting("promptTemplate", input.promptTemplate);
      return effectiveConfig(ctx);
    }),
  }),
  corrections: t.router({
    list: t.procedure.query(({ ctx }) =>
      withCorrections(ctx.root, (store) => store.list()),
    ),
    record: t.procedure
      .input(correctionInputSchema)
      .mutation(async ({ ctx, input }) => {
        const agent = createIngestAgent({ root: ctx.root });
        try {
          return await agent.recordCorrection(input);
        } finally {
          await agent.close();
        }
      }),
    delete: t.procedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => {
        const removed = withCorrections(ctx.root, (store) =>
          store.remove(input.id),
        );
        if (!removed) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Correction not found",
          });
        }
        return { id: input.id };
      }),
  }),
  memory: t.router({
    categories: t.procedure.query(({ ctx }) =>
      withCategories(ctx.root, (store) =>
        store.list().map((category) => ({
          id: category.id,
          name: category.name,
          definition: category.definition,
          folder: category.folder,
          parentId: category.parentId,
          isSeed: category.isSeed,
          createdAt: category.createdAt,
        })),
      ),
    ),
    documents: t.procedure.query(({ ctx }) =>
      withDocuments(ctx.root, (store) =>
        store.list().map((document) => ({
          id: document.id,
          sourcePath: document.sourcePath,
          destinationPath: document.destinationPath,
          categoryId: document.categoryId,
          summary: document.summary,
          embeddingStatus: document.embeddingStatus,
          embeddingError: document.embeddingError,
          updatedAt: document.updatedAt,
        })),
      ),
    ),
    audit: t.procedure.query(({ ctx }) =>
      withAudit(ctx.root, (store) => store.list().slice().reverse()),
    ),
  }),
  runs: t.router({
    start: t.procedure.input(runInput).mutation(({ ctx, input }) => {
      const run = ctx.store.openRun(input.action, input.input ?? {});
      const observer = ctx.store.observer(run.id);
      const actionSpan = observer.start({
        parentId: null,
        name: input.action,
        kind: "action",
        input: input.input ?? {},
      });
      void executeRun(ctx, run.id, actionSpan, input);
      return { runId: run.id };
    }),
    list: t.procedure.query(({ ctx }) => ctx.store.listRuns()),
    get: t.procedure
      .input(z.object({ runId: z.string().min(1) }))
      .query(({ ctx, input }) => {
        const run = ctx.store.getRun(input.runId);
        if (!run) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Unknown run" });
        }
        return { ...run, spans: ctx.store.listSpans(run.id) };
      }),
    follow: t.procedure.input(followInput).subscription(async function* ({
      ctx,
      input,
      signal,
    }) {
      const run = ctx.store.getRun(input.runId);
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Unknown run" });
      }
      const seen = new Set<string>();
      const queue: StudioSpan[] = [];
      let notify: (() => void) | undefined;
      const unsubscribe = ctx.store.subscribe(input.runId, (span) => {
        queue.push(span);
        notify?.();
        notify = undefined;
      });
      try {
        for (const item of replay(
          ctx.store.listSpans(input.runId),
          input.lastEventId,
        )) {
          seen.add(item.key);
          yield item.span;
        }
        let current = ctx.store.getRun(input.runId);
        while (current?.status === "running") {
          if (signal?.aborted) return;
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              notify = resolve;
              signal?.addEventListener("abort", () => resolve(), {
                once: true,
              });
            });
            notify = undefined;
          }
          if (signal?.aborted) return;
          while (queue.length > 0) {
            const span = queue.shift();
            if (!span) continue;
            const key = spanKey(span);
            if (seen.has(key)) continue;
            seen.add(key);
            yield span;
          }
          current = ctx.store.getRun(input.runId);
        }
      } finally {
        unsubscribe();
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;

async function withEvidence<T>(
  ctx: StudioContext,
  operation: (agent: EvidenceAgent) => Promise<T>,
): Promise<T> {
  const config = effectiveConfig(ctx);
  const agent = createEvidenceAgent({
    root: ctx.root,
    createModel: ctx.createModel,
    fitThreshold: config.fitThreshold,
    dedupThreshold: config.dedupThreshold,
    exampleLimit: config.exampleLimit,
    promptTemplate: ctx.store.readSettings().promptTemplate ?? undefined,
  });
  try {
    return await operation(agent);
  } finally {
    await agent.close();
  }
}

/** Build a caller for tests. The HTTP server uses the same router. */
export function createStudioCaller(
  ctx: StudioContext,
): ReturnType<AppRouter["createCaller"]> {
  return appRouter.createCaller(ctx);
}

type RunRequest = z.infer<typeof runInput>;

function effectiveConfig(ctx: StudioContext): {
  fitThreshold: number;
  dedupThreshold: number;
  exampleLimit: number;
  promptTemplate: string;
  defaults: {
    fitThreshold: number;
    dedupThreshold: number;
    exampleLimit: number;
    promptTemplate: string;
  };
} {
  const stored = ctx.store.readSettings();
  const defaults = {
    fitThreshold: EXISTING_CATEGORY_FIT_THRESHOLD,
    dedupThreshold: ctx.envDedupThreshold ?? DEFAULT_CATEGORY_DEDUP_THRESHOLD,
    exampleLimit: DEFAULT_CORRECTION_EXAMPLE_LIMIT,
    promptTemplate: DEFAULT_ADAPTIVE_ORGANIZER_TEMPLATE,
  };
  return {
    fitThreshold: stored.fitThreshold ?? defaults.fitThreshold,
    dedupThreshold: stored.dedupThreshold ?? defaults.dedupThreshold,
    exampleLimit: stored.exampleLimit ?? defaults.exampleLimit,
    promptTemplate: stored.promptTemplate ?? defaults.promptTemplate,
    defaults,
  };
}

async function executeRun(
  ctx: StudioContext,
  runId: string,
  actionSpan: string,
  input: RunRequest,
): Promise<void> {
  const config = effectiveConfig(ctx);
  const observer = ctx.store.observer(runId);
  const agent = createIngestAgent({
    root: ctx.root,
    createModel: ctx.createModel,
    dedupThreshold: config.dedupThreshold,
    fitThreshold: config.fitThreshold,
    exampleLimit: config.exampleLimit,
    promptTemplate: ctx.store.readSettings().promptTemplate ?? undefined,
    trace: { observer, parentId: actionSpan },
  });
  try {
    const result = await dispatch(agent, input);
    ctx.store.finishRun(runId, {
      status: result.status,
      output: result.data,
      error: result.error,
    });
    observer.end(actionSpan, {
      status: result.status === "error" ? "failed" : "ok",
      output: result,
      error: result.error?.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.store.finishRun(runId, {
      status: "error",
      output: null,
      error: { code: "OPERATION_FAILED", message },
    });
    observer.end(actionSpan, { status: "failed", error: message });
  } finally {
    await agent.close();
  }
}

function dispatch(
  agent: ReturnType<typeof createIngestAgent>,
  input: RunRequest,
): Promise<OperationResult<unknown>> {
  switch (input.action) {
    case "ingest_inbox":
      return agent.ingestInbox(input.input ?? {});
    case "search_documents":
      return agent.searchDocuments(input.input);
    case "ask_question":
      return agent.askQuestion(input.input);
    case "suggest_category_splits":
      return agent.suggestCategorySplits(input.input ?? {});
    case "record_correction":
      return agent.recordCorrection(input.input);
    case "backfill_embeddings":
      return agent.backfillEmbeddings(input.input ?? {});
  }
}

function* replay(
  spans: StudioSpan[],
  lastEventId: string | null | undefined,
): Generator<{ key: string; span: StudioSpan }> {
  const keys = spans.map(spanKey);
  const resumeAt = lastEventId ? keys.indexOf(lastEventId) : -1;
  const start = resumeAt >= 0 ? resumeAt + 1 : 0;
  for (const span of spans.slice(start)) {
    yield { key: spanKey(span), span };
  }
}

function spanKey(span: StudioSpan): string {
  return `${span.id}:${span.status}:${span.endedAt ?? "open"}`;
}

function withCorrections<T>(
  root: string,
  read: (store: CorrectionStore) => T,
): T {
  const store = new CorrectionStore(getLibraryPaths(root).database);
  try {
    return read(store);
  } finally {
    store.close();
  }
}

function withCategories<T>(root: string, read: (store: CategoryStore) => T): T {
  const paths = getLibraryPaths(root);
  const store = new CategoryStore(paths.database, paths.root);
  try {
    return read(store);
  } finally {
    store.close();
  }
}

function withDocuments<T>(root: string, read: (store: DocumentStore) => T): T {
  const store = new DocumentStore(getLibraryPaths(root).database);
  try {
    return read(store);
  } finally {
    store.close();
  }
}

function withAudit<T>(root: string, read: (store: AuditStore) => T): T {
  const store = new AuditStore(getLibraryPaths(root).database);
  try {
    return read(store);
  } finally {
    store.close();
  }
}

export type { StudioRun };
