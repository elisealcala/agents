/** Independent manager router. Every project operation carries its project identity. */
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Manager } from "../application/manager.ts";
import type { RuntimeCapabilities } from "./runtime-config.ts";
const t = initTRPC
  .context<{
    manager: Manager;
    model: string;
    capabilities?: RuntimeCapabilities;
  }>()
  .create();
const id = z.string().uuid();
const text = z.string().trim().min(1);
const procedure = t.procedure;
export const appRouter = t.router({
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
