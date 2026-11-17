/**
 * Creates a missing manager-owned single-select field as its own recoverable
 * operation. A pending receipt (with the pre-dispatch field inventory) is saved
 * before dispatch; retries reconcile against GitHub before creating again.
 */
import { GitHubTransportError } from "./client.ts";
import type { ProjectField } from "./projects.ts";

export interface ProjectFieldsTransport {
  listProjectFields(
    token: string,
    projectId: string,
  ): Promise<readonly ProjectField[]>;
  createSingleSelectField(
    token: string,
    projectId: string,
    name: string,
    options: readonly string[],
  ): Promise<ProjectField>;
}

export interface ProjectFieldReceipt {
  operationId: string;
  projectId: string;
  name: string;
  baselineFieldIds: readonly string[];
  status: "pending" | "confirmed";
  fieldId?: string;
  /** Option name -> immutable option id. */
  optionIds?: Readonly<Record<string, string>>;
}

/** Persistence boundary; must be durable across restarts. */
export interface ProjectFieldReceiptStore {
  get(operationId: string): ProjectFieldReceipt | undefined;
  save(receipt: ProjectFieldReceipt): void;
}

export interface EnsureFieldInput {
  operationId: string;
  projectId: string;
  name: string;
  options: readonly string[];
}

export type EnsureFieldResult =
  | {
      ok: true;
      fieldId: string;
      optionIds: Readonly<Record<string, string>>;
      created: boolean;
    }
  | {
      ok: false;
      reason:
        | "ambiguous"
        | "field_not_single_select"
        | "unavailable"
        | "projects_access_denied"
        | "projects_credentials_expired";
      /** The step left unresolved; its receipt stays pending. */
      unresolvedStep: "create_field";
      candidates?: readonly string[];
    };

function failure(error: unknown): EnsureFieldResult {
  const unresolvedStep = "create_field" as const;
  if (error instanceof GitHubTransportError) {
    if (error.kind === "forbidden")
      return { ok: false, reason: "projects_access_denied", unresolvedStep };
    if (error.kind === "unauthorized")
      return {
        ok: false,
        reason: "projects_credentials_expired",
        unresolvedStep,
      };
  }
  return { ok: false, reason: "unavailable", unresolvedStep };
}

function confirm(
  store: ProjectFieldReceiptStore,
  receipt: ProjectFieldReceipt,
  field: ProjectField,
  created: boolean,
): EnsureFieldResult {
  const optionIds: Record<string, string> = {};
  for (const o of field.options) optionIds[o.name] = o.id;
  store.save({
    ...receipt,
    status: "confirmed",
    fieldId: field.id,
    optionIds,
  });
  return { ok: true, fieldId: field.id, optionIds, created };
}

export async function ensureManagerField(
  transport: ProjectFieldsTransport,
  token: string,
  store: ProjectFieldReceiptStore,
  input: EnsureFieldInput,
): Promise<EnsureFieldResult> {
  const existing = store.get(input.operationId);
  if (existing?.status === "confirmed" && existing.fieldId !== undefined)
    return {
      ok: true,
      fieldId: existing.fieldId,
      optionIds: existing.optionIds ?? {},
      created: false,
    };

  let fields: readonly ProjectField[];
  try {
    fields = await transport.listProjectFields(token, input.projectId);
  } catch (error) {
    return failure(error);
  }
  const receipt: ProjectFieldReceipt = existing ?? {
    operationId: input.operationId,
    projectId: input.projectId,
    name: input.name,
    baselineFieldIds: fields.map((f) => f.id),
    status: "pending",
  };

  // Same-named fields (pre-existing or from a lost response) are adopted,
  // never duplicated or modified.
  const sameName = fields.filter((f) => f.name === input.name);
  if (sameName.length > 1)
    return {
      ok: false,
      reason: "ambiguous",
      unresolvedStep: "create_field",
      candidates: sameName.map((f) => f.id),
    };
  if (sameName.length === 1) {
    if (sameName[0].type !== "single_select")
      return {
        ok: false,
        reason: "field_not_single_select",
        unresolvedStep: "create_field",
        candidates: [sameName[0].id],
      };
    return confirm(store, receipt, sameName[0], false);
  }

  if (!existing) store.save(receipt); // marker persisted before dispatch
  try {
    const field = await transport.createSingleSelectField(
      token,
      input.projectId,
      input.name,
      input.options,
    );
    return confirm(store, receipt, field, true);
  } catch (error) {
    return failure(error); // receipt stays pending; next attempt reconciles
  }
}
