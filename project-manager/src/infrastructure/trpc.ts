/** Shared transport context and inbound adapter for local projects. */
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { Manager } from "../application/manager.ts";
import { PROJECT_NAME_MAX_LENGTH } from "../domain/projects.ts";
import type {
  ProjectCreateReceiptStore,
  ProjectCreateTransport,
} from "../integrations/github/project-create.ts";
import type { GitHubProjectsTransport } from "../integrations/github/projects.ts";
import type { RuntimeCapabilities } from "../server/runtime-config.ts";
import type { ConnectionStore } from "../storage/connection-store.ts";
import type { ProjectBindingStore } from "../storage/project-bindings.ts";

export const t = initTRPC
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

export const projectsRouter = t.router({
  create: t.procedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
      }),
    )
    .mutation(({ ctx, input }) => ctx.manager.projects.create(input.name)),
  list: t.procedure.query(({ ctx }) => ctx.manager.projects.list()),
  get: t.procedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => ctx.manager.projects.get(input.projectId)),
});
