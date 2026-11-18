/** Independent manager router. Every project operation carries its project identity. */
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Manager } from "../application/manager.ts";
import {
  ConnectionError,
  connectionKinds,
} from "../integrations/github/connections.ts";
import {
  createMissingProject,
  type ProjectCreateReceiptStore,
  type ProjectCreateTransport,
} from "../integrations/github/project-create.ts";
import {
  adoptProject,
  discoverProjects,
  type GitHubProjectsTransport,
} from "../integrations/github/projects.ts";
import type { ConnectionStore } from "../storage/connection-store.ts";
import {
  ProjectBindingError,
  type ProjectBindingStore,
} from "../storage/project-bindings.ts";
import type { RuntimeCapabilities } from "./runtime-config.ts";
const t = initTRPC
  .context<{
    manager: Manager;
    model: string;
    capabilities?: RuntimeCapabilities;
    /** Set by the authenticated server layer only; connection routes require it. */
    owner?: boolean;
    connections?: ConnectionStore;
    /** Server-side Projects provider boundary; never exposed to clients. */
    projectsTransport?: GitHubProjectsTransport & ProjectCreateTransport;
    projectBindings?: ProjectBindingStore;
    /** Durable creation receipts (must survive restarts). */
    projectCreateReceipts?: ProjectCreateReceiptStore;
  }>()
  .create();
const id = z.string().uuid();
const text = z.string().trim().min(1);
const procedure = t.procedure;
const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.owner !== true) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!ctx.connections)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Connections are not configured",
    });
  return next({ ctx: { ...ctx, connections: ctx.connections } });
});
/** Owner-only Projects boundary: requires transport, binding store and receipts. */
const projectsProcedure = ownerProcedure.use(({ ctx, next }) => {
  if (
    !ctx.projectsTransport ||
    !ctx.projectBindings ||
    !ctx.projectCreateReceipts
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Projects are not configured",
    });
  return next({
    ctx: {
      ...ctx,
      projectsTransport: ctx.projectsTransport,
      projectBindings: ctx.projectBindings,
      projectCreateReceipts: ctx.projectCreateReceipts,
    },
  });
});
type ProjectsCtx = {
  manager: Manager;
  connections: ConnectionStore;
};
/** Resolves the separate Projects credential server-side; never returned to callers. */
function projectsToken(
  ctx: ProjectsCtx,
): { ok: true; token: string } | { ok: false; reason: string } {
  const connection = ctx.connections
    .list()
    .find(
      (c) =>
        c.kind === "projects" && c.status !== "disconnected" && c.hasCredential,
    );
  if (!connection || connection.capabilities.projectsRead === false)
    return { ok: false, reason: "projects_access_denied" };
  try {
    return { ok: true, token: ctx.connections.readCredential(connection.id) };
  } catch {
    return { ok: false, reason: "projects_access_denied" };
  }
}
/** Requires a verified immutable numeric repository ID known to the manager. */
function verifyRepository(
  ctx: ProjectsCtx,
  input: { repositoryId: number; owner?: string; name?: string },
): void {
  const repo = ctx.manager.store.delivery
    .listRepositories()
    .find((r) => r.identity.repositoryId === String(input.repositoryId));
  if (!repo)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Unknown repository",
    });
  if (
    (input.owner !== undefined && repo.identity.owner !== input.owner) ||
    (input.name !== undefined && repo.identity.name !== input.name)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Repository identity mismatch",
    });
}
const repositoryInput = {
  repositoryId: z.number().int().positive().safe(),
  owner: text.max(200).optional(),
  name: text.max(200).optional(),
};
/** Store errors are already credential-free; map them to stable API codes. */
function guarded<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof ConnectionError)) throw error;
    const code = /conflict|exists/i.test(error.message)
      ? "CONFLICT"
      : /unknown/i.test(error.message)
        ? "NOT_FOUND"
        : "BAD_REQUEST";
    throw new TRPCError({ code, message: error.message });
  }
}
const connectionId = text.max(200);
const revision = z.number().int().nonnegative();
const capabilityInput = z.strictObject({
  repositoryRead: z.boolean().optional(),
  projectsRead: z.boolean().optional(),
  inventorySync: z.boolean().optional(),
  projectWrites: z.boolean().optional(),
});
export const appRouter = t.router({
  githubProjects: t.router({
    /** Read-only discovery with the Projects credential. */
    discover: projectsProcedure.query(async ({ ctx }) => {
      const access = projectsToken(ctx);
      if (!access.ok) return { ok: false as const, code: access.reason };
      const result = await discoverProjects(
        ctx.projectsTransport,
        access.token,
      );
      return result.ok
        ? { ok: true as const, projects: result.value }
        : { ok: false as const, code: result.reason };
    }),
    binding: projectsProcedure
      .input(z.strictObject(repositoryInput))
      .query(({ ctx, input }) => {
        verifyRepository(ctx, input);
        return {
          ok: true as const,
          binding: ctx.projectBindings.get(input.repositoryId) ?? null,
        };
      }),
    adopt: projectsProcedure
      .input(
        z.strictObject({
          ...repositoryInput,
          projectId: text.max(200),
          statusFieldId: text.max(200).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        verifyRepository(ctx, input);
        const existing = ctx.projectBindings.get(input.repositoryId);
        if (existing && existing.projectId !== input.projectId)
          return { ok: false as const, code: "already_bound" };
        const access = projectsToken(ctx);
        if (!access.ok) return { ok: false as const, code: access.reason };
        try {
          const result = await adoptProject(
            ctx.projectsTransport,
            access.token,
            ctx.projectBindings,
            {
              repositoryId: input.repositoryId,
              projectId: input.projectId,
              fieldMapping:
                input.statusFieldId === undefined
                  ? undefined
                  : { statusFieldId: input.statusFieldId },
            },
          );
          if (result.ok) return { ok: true as const, binding: result.binding };
          return {
            ok: false as const,
            code: result.reason,
            candidates: "candidates" in result ? result.candidates : undefined,
          };
        } catch (error) {
          if (error instanceof ProjectBindingError)
            return { ok: false as const, code: "already_bound" };
          return { ok: false as const, code: "unavailable" };
        }
      }),
    /** Creates the board only; adoption/mapping is a separate step. */
    create: projectsProcedure
      .input(
        z.strictObject({
          ...repositoryInput,
          operationId: text.max(200),
          title: text.max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        verifyRepository(ctx, input);
        const receipt = ctx.projectCreateReceipts.get(input.operationId);
        if (
          receipt &&
          (receipt.repositoryId !== input.repositoryId ||
            receipt.title !== input.title)
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "Operation belongs to a different request",
          });
        const access = projectsToken(ctx);
        if (!access.ok) return { ok: false as const, code: access.reason };
        try {
          const result = await createMissingProject(
            ctx.projectsTransport,
            access.token,
            ctx.projectCreateReceipts,
            {
              operationId: input.operationId,
              repositoryId: input.repositoryId,
              title: input.title,
            },
          );
          if (result.ok)
            return {
              ok: true as const,
              projectId: result.projectId,
              projectNumber: result.projectNumber,
              created: result.created,
            };
          return {
            ok: false as const,
            code:
              result.reason === "ambiguous"
                ? "ambiguous_create"
                : result.reason,
            candidates: result.candidates,
          };
        } catch {
          return { ok: false as const, code: "unavailable" };
        }
      }),
  }),
  connections: t.router({
    list: ownerProcedure.query(({ ctx }) =>
      guarded(() => ctx.connections.list()),
    ),
    get: ownerProcedure
      .input(z.strictObject({ id: connectionId }))
      .query(({ ctx, input }) => guarded(() => ctx.connections.get(input.id))),
    receipts: ownerProcedure
      .input(z.strictObject({ id: connectionId }))
      .query(({ ctx, input }) =>
        guarded(() => {
          ctx.connections.get(input.id);
          return ctx.connections.receipts(input.id);
        }),
      ),
    connect: ownerProcedure
      .input(
        z.strictObject({
          id: connectionId,
          kind: z.enum(connectionKinds),
          externalRef: text.max(500),
          credential: z.string().min(1).max(8192),
          capabilities: capabilityInput.optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        guarded(() => ctx.connections.create(input)),
      ),
    updateState: ownerProcedure
      .input(
        z.strictObject({
          id: connectionId,
          expectedRevision: revision,
          status: z.enum(["connected", "degraded"]),
          capabilities: capabilityInput,
        }),
      )
      .mutation(({ ctx, input }) =>
        guarded(() =>
          ctx.connections.updateState(
            input.id,
            input.expectedRevision,
            input.status,
            input.capabilities,
          ),
        ),
      ),
    rotate: ownerProcedure
      .input(
        z.strictObject({
          id: connectionId,
          expectedRevision: revision,
          credential: z.string().min(1).max(8192),
        }),
      )
      .mutation(({ ctx, input }) =>
        guarded(() =>
          ctx.connections.rotate(
            input.id,
            input.expectedRevision,
            input.credential,
          ),
        ),
      ),
    disconnect: ownerProcedure
      .input(z.strictObject({ id: connectionId, expectedRevision: revision }))
      .mutation(({ ctx, input }) =>
        guarded(() =>
          ctx.connections.disconnect(input.id, input.expectedRevision),
        ),
      ),
  }),
  delivery: t.router({
    bindKnownRepository: procedure
      .input(z.strictObject({ name: z.enum(["agents", "chore-design"]) }))
      .mutation(({ ctx, input }) => {
        // Public repository identities observed via GitHub on 2026-11-01; this is a local reference, not a connection.
        const ids = {
          agents: "1355217430",
          "chore-design": "1437904422",
        } as const;
        const identity = {
          provider: "github" as const,
          repositoryId: ids[input.name],
          owner: "elisealcala",
          name: input.name,
        };
        const existing = ctx.manager.store.delivery
          .listRepositories()
          .find((repo) => repo.identity.repositoryId === identity.repositoryId);
        if (existing) {
          if (
            existing.identity.owner !== identity.owner ||
            existing.identity.name !== identity.name ||
            existing.identity.provider !== identity.provider
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "The repository ID is already bound to a different local reference.",
            });
          return existing;
        }
        return ctx.manager.store.delivery.registerRepository(identity);
      }),
    repositories: procedure.query(({ ctx }) =>
      ctx.manager.store.delivery.listRepositories(),
    ),
    work: procedure
      .input(z.object({ repositoryId: text.max(200) }))
      .query(({ ctx, input }) =>
        ctx.manager.store.delivery.listWork(input.repositoryId),
      ),
    outbox: procedure
      .input(z.object({ repositoryId: text.max(200) }))
      .query(({ ctx, input }) =>
        ctx.manager.store.delivery.listOutbox(input.repositoryId),
      ),
  }),
  agent: t.router({
    configuration: procedure.query(
      ({ ctx }) =>
        ctx.capabilities ?? {
          evidence: "unconfigured",
          model: "unconfigured",
          intake: "unconfigured",
          conversation: "unconfigured",
        },
    ),
    identity: procedure.query(({ ctx }) => ({
      id: "project-manager",
      kind: "project-manager",
      name: "Project manager",
      model: ctx.model,
    })),
  }),
  projects: t.router({
    create: procedure
      .input(z.object({ name: text.max(200) }))
      .mutation(({ ctx, input }) => ctx.manager.store.create(input.name)),
    list: procedure.query(({ ctx }) => ctx.manager.store.list()),
    get: procedure
      .input(z.object({ projectId: id }))
      .query(({ ctx, input }) => ctx.manager.store.get(input.projectId)),
  }),
  notes: t.router({
    submit: procedure
      .input(
        z.object({
          projectId: id,
          sourceId: text.max(200),
          sourceVersion: text.max(100),
          markdown: z
            .string()
            .min(1)
            .max(30000)
            .refine(
              (value) =>
                value.trim().length > 0 &&
                Buffer.from(value, "utf8").toString("utf8") === value,
              { message: "Submit nonempty valid Unicode Markdown" },
            ),
          sourceDate: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.manager.submit(input.projectId, input)),
    retry: procedure
      .input(z.object({ projectId: id, noteId: id }))
      .mutation(({ ctx, input }) =>
        ctx.manager.retry(input.projectId, input.noteId),
      ),
  }),
  reviews: t.router({
    list: procedure
      .input(z.object({ projectId: id }))
      .query(({ ctx, input }) =>
        ctx.manager.store
          .get(input.projectId)
          .candidates.filter((c) => c.status === "pending"),
      ),
    resolve: procedure
      .input(
        z.object({
          projectId: id,
          candidateId: id,
          action: z.enum(["accept", "edit", "reject"]),
          expectedRevision: z.number().int().nonnegative(),
          value: text.max(2000).optional(),
          effectiveDate: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.manager.review(input.projectId, input)),
  }),
  conversations: t.router({
    send: procedure
      .input(
        z.object({
          projectId: id,
          conversationId: id.optional(),
          question: text.max(2000),
        }),
      )
      .mutation(({ ctx, input }) => ctx.manager.ask(input.projectId, input)),
  }),
  runs: t.router({
    list: procedure
      .input(z.object({ projectId: id }))
      .query(({ ctx, input }) => ctx.manager.store.runs(input.projectId)),
    get: procedure
      .input(z.object({ projectId: id, runId: id }))
      .query(({ ctx, input }) => {
        const run = ctx.manager.store.getRun(input.runId);
        if (run.projectId !== input.projectId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Run does not belong to this project",
          });
        return run;
      }),
  }),
  evidence: t.router({
    read: procedure
      .input(z.object({ projectId: id, documentRef: text }))
      .query(({ ctx, input }) =>
        ctx.manager.read(input.projectId, input.documentRef),
      ),
  }),
  evaluations: t.router({
    list: procedure.query(({ ctx }) => ctx.manager.store.evaluations()),
    get: procedure
      .input(z.object({ id: text }))
      .query(({ ctx, input }) => ctx.manager.store.getEvaluation(input.id)),
  }),
});
export type AppRouter = typeof appRouter;
