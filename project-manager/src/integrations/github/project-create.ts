/**
 * Creates one explicitly selected missing Project. A receipt (creation marker
 * with the pre-dispatch board inventory) is persisted before dispatch so an
 * unknown outcome is reconciled against GitHub before any retry.
 */
import { GitHubTransportError } from "./client.ts";
import type { ProjectSummary } from "./projects.ts";

export interface ProjectCreateTransport {
  listOwnerProjects(token: string): Promise<readonly ProjectSummary[]>;
  createProject(token: string, title: string): Promise<ProjectSummary>;
}

export interface ProjectCreateReceipt {
  operationId: string;
  repositoryId: number;
  title: string;
  /** Project ids that existed before dispatch. */
  baselineProjectIds: readonly string[];
  status: "pending" | "confirmed";
  projectId?: string;
  projectNumber?: number;
}

/** Persistence boundary; must be durable across restarts. */
export interface ProjectCreateReceiptStore {
  get(operationId: string): ProjectCreateReceipt | undefined;
  save(receipt: ProjectCreateReceipt): void;
  /** True when the repository already has an adopted/created Project. */
  hasBinding(repositoryId: number): boolean;
}

export interface CreateProjectInput {
  operationId: string;
  repositoryId: number;
  title: string;
}

export type CreateProjectResult =
  | {
      ok: true;
      projectId: string;
      projectNumber: number;
      created: boolean;
    }
  | {
      ok: false;
      reason:
        | "already_bound"
        | "title_exists"
        | "ambiguous"
        | "unavailable"
        | "projects_access_denied"
        | "projects_credentials_expired";
      candidates?: readonly string[];
    };

function failure(error: unknown): CreateProjectResult {
  if (error instanceof GitHubTransportError) {
    if (error.kind === "forbidden")
      return { ok: false, reason: "projects_access_denied" };
    if (error.kind === "unauthorized")
      return { ok: false, reason: "projects_credentials_expired" };
  }
  return { ok: false, reason: "unavailable" };
}

function confirm(
  store: ProjectCreateReceiptStore,
  receipt: ProjectCreateReceipt,
  project: ProjectSummary,
  created: boolean,
): CreateProjectResult {
  store.save({
    ...receipt,
    status: "confirmed",
    projectId: project.id,
    projectNumber: project.number,
  });
  return {
    ok: true,
    projectId: project.id,
    projectNumber: project.number,
    created,
  };
}

export async function createMissingProject(
  transport: ProjectCreateTransport,
  token: string,
  store: ProjectCreateReceiptStore,
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const existing = store.get(input.operationId);
  if (existing?.status === "confirmed" && existing.projectId !== undefined)
    return {
      ok: true,
      projectId: existing.projectId,
      projectNumber: existing.projectNumber ?? 0,
      created: false,
    };
  if (!existing && store.hasBinding(input.repositoryId))
    return { ok: false, reason: "already_bound" };

  let remote: readonly ProjectSummary[];
  try {
    remote = await transport.listOwnerProjects(token);
  } catch (error) {
    return failure(error);
  }
  const sameTitle = remote.filter((p) => p.title === input.title);

  if (existing) {
    // Unknown outcome: reconcile before any retry.
    const known = new Set(existing.baselineProjectIds);
    const fresh = sameTitle.filter((p) => !known.has(p.id));
    if (fresh.length > 1)
      return {
        ok: false,
        reason: "ambiguous",
        candidates: fresh.map((p) => p.id),
      };
    if (fresh.length === 1) return confirm(store, existing, fresh[0], false);
  } else if (sameTitle.length > 0) {
    return { ok: false, reason: "title_exists" };
  }

  const receipt: ProjectCreateReceipt = existing ?? {
    operationId: input.operationId,
    repositoryId: input.repositoryId,
    title: input.title,
    baselineProjectIds: remote.map((p) => p.id),
    status: "pending",
  };
  if (!existing) store.save(receipt); // marker persisted before dispatch
  try {
    const project = await transport.createProject(token, input.title);
    return confirm(store, receipt, project, true);
  } catch (error) {
    // Receipt stays pending; the next attempt reconciles first.
    return failure(error);
  }
}
