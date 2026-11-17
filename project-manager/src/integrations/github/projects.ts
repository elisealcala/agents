/**
 * Read-only discovery and adoption of existing personal Projects. Uses the
 * separate Projects credential; never creates or edits boards, fields or items.
 */
import { GitHubTransportError } from "./client.ts";

export type ProjectFieldType =
  | "text"
  | "number"
  | "date"
  | "single_select"
  | "iteration"
  | "other";

export interface ProjectFieldOption {
  id: string;
  name: string;
}

export interface ProjectField {
  /** Immutable node id. */
  id: string;
  name: string;
  type: ProjectFieldType;
  options: readonly ProjectFieldOption[];
}

export interface ProjectSummary {
  /** Immutable node id. */
  id: string;
  number: number;
  title: string;
  ownerLogin: string;
}

/** Provider boundary (read-only). `token` is the Projects credential. */
export interface GitHubProjectsTransport {
  listOwnerProjects(token: string): Promise<readonly ProjectSummary[]>;
  listProjectFields(
    token: string,
    projectId: string,
  ): Promise<readonly ProjectField[]>;
}

/** Distinct from repository App access: these describe the Projects credential only. */
export type ProjectsFailure =
  | "projects_access_denied"
  | "projects_credentials_expired"
  | "project_not_found"
  | "unavailable";

export type ProjectsResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ProjectsFailure };

function failure(error: unknown): { ok: false; reason: ProjectsFailure } {
  if (error instanceof GitHubTransportError) {
    if (error.kind === "forbidden")
      return { ok: false, reason: "projects_access_denied" };
    if (error.kind === "unauthorized")
      return { ok: false, reason: "projects_credentials_expired" };
    if (error.kind === "not_found")
      return { ok: false, reason: "project_not_found" };
  }
  return { ok: false, reason: "unavailable" };
}

export interface ProjectDiscovery {
  project: ProjectSummary;
  fields: readonly ProjectField[];
}

export async function discoverProjects(
  transport: GitHubProjectsTransport,
  token: string,
): Promise<ProjectsResult<readonly ProjectDiscovery[]>> {
  try {
    const projects = await transport.listOwnerProjects(token);
    const found: ProjectDiscovery[] = [];
    for (const project of projects)
      found.push({
        project,
        fields: await transport.listProjectFields(token, project.id),
      });
    return { ok: true, value: found };
  } catch (error) {
    return failure(error);
  }
}

/** Explicit mapping of manager roles to immutable field ids. */
export interface ProjectFieldMapping {
  statusFieldId: string;
  /** Snapshot of the option ids present when adopted. */
  statusOptionIds: readonly string[];
}

export interface ExplicitFieldMapping {
  statusFieldId?: string;
}

export type MappingResolution =
  | { ok: true; mapping: ProjectFieldMapping }
  | {
      ok: false;
      reason: "mapping_required" | "mapping_invalid";
      /** Candidate single-select field ids to choose from. */
      candidates: readonly string[];
    };

/**
 * Never guesses: without an explicit choice, a mapping is only inferred when
 * exactly one single-select field is named "Status" (exact match).
 */
export function resolveFieldMapping(
  fields: readonly ProjectField[],
  explicit?: ExplicitFieldMapping,
): MappingResolution {
  const selects = fields.filter((f) => f.type === "single_select");
  const candidates = selects.map((f) => f.id);
  let chosen: ProjectField | undefined;
  if (explicit?.statusFieldId !== undefined) {
    chosen = selects.find((f) => f.id === explicit.statusFieldId);
    if (!chosen) return { ok: false, reason: "mapping_invalid", candidates };
  } else {
    const named = selects.filter((f) => f.name === "Status");
    if (named.length !== 1)
      return { ok: false, reason: "mapping_required", candidates };
    chosen = named[0];
  }
  if (chosen.options.length === 0)
    return { ok: false, reason: "mapping_invalid", candidates };
  return {
    ok: true,
    mapping: {
      statusFieldId: chosen.id,
      statusOptionIds: chosen.options.map((o) => o.id),
    },
  };
}

export interface ProjectBindingRecord {
  repositoryId: number;
  projectId: string;
  projectNumber: number;
  mapping: ProjectFieldMapping;
}

/** Persistence boundary, implemented by storage/project-bindings.ts. */
export interface ProjectBindingSink {
  bind(record: ProjectBindingRecord): ProjectBindingRecord;
}

export type AdoptionResult =
  | { ok: true; binding: ProjectBindingRecord }
  | ProjectsFailureResult
  | {
      ok: false;
      reason: "mapping_required" | "mapping_invalid";
      candidates: readonly string[];
    };
type ProjectsFailureResult = { ok: false; reason: ProjectsFailure };

export interface AdoptProjectInput {
  repositoryId: number;
  /** Explicitly chosen Project node id. */
  projectId: string;
  fieldMapping?: ExplicitFieldMapping;
}

/** Adopts an existing Project as-is; only read calls are made against GitHub. */
export async function adoptProject(
  transport: GitHubProjectsTransport,
  token: string,
  sink: ProjectBindingSink,
  input: AdoptProjectInput,
): Promise<AdoptionResult> {
  let project: ProjectSummary | undefined;
  let fields: readonly ProjectField[];
  try {
    project = (await transport.listOwnerProjects(token)).find(
      (p) => p.id === input.projectId,
    );
    if (!project) return { ok: false, reason: "project_not_found" };
    fields = await transport.listProjectFields(token, project.id);
  } catch (error) {
    return failure(error);
  }
  const resolved = resolveFieldMapping(fields, input.fieldMapping);
  if (!resolved.ok)
    return {
      ok: false,
      reason: resolved.reason,
      candidates: resolved.candidates,
    };
  return {
    ok: true,
    binding: sink.bind({
      repositoryId: input.repositoryId,
      projectId: project.id,
      projectNumber: project.number,
      mapping: resolved.mapping,
    }),
  };
}
