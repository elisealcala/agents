/**
 * Adds issue items to a bound Project and updates the mapped Status field as
 * separately recorded operations. Receipts are saved before dispatch; GraphQL
 * partial errors keep any confirmed id and name the unresolved step.
 */
import { GitHubTransportError } from "./client.ts";
import type { ProjectFieldMapping } from "./projects.ts";

export interface ProjectItem {
  itemId: string;
  /** Node id of the issue content. */
  contentId: string;
  /** Field id -> current single-select option id. */
  fieldValues: Readonly<Record<string, string | undefined>>;
}

/** A GraphQL response may carry data and errors together. */
export interface AddItemResponse {
  itemId?: string;
  errors?: readonly string[];
}
export interface UpdateFieldResponse {
  errors?: readonly string[];
}

export interface ProjectItemsTransport {
  listProjectItems(
    token: string,
    projectId: string,
  ): Promise<readonly ProjectItem[]>;
  addItem(
    token: string,
    projectId: string,
    contentId: string,
  ): Promise<AddItemResponse>;
  updateFieldValue(
    token: string,
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<UpdateFieldResponse>;
}

export type ProjectStep = "add_item" | "update_field";

export interface ProjectItemReceipt {
  operationId: string;
  step: ProjectStep;
  projectId: string;
  contentId?: string;
  itemId?: string;
  fieldId?: string;
  desiredOptionId?: string;
  status: "pending" | "confirmed";
}

/** Persistence boundary; must be durable across restarts. */
export interface ProjectItemReceiptStore {
  get(operationId: string): ProjectItemReceipt | undefined;
  save(receipt: ProjectItemReceipt): void;
}

export type ProjectStepFailure =
  | "unavailable"
  | "partial_error"
  | "projects_access_denied"
  | "projects_credentials_expired"
  | "item_not_found"
  | "unbound_id"
  | "conflict";

export type ProjectStepResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      reason: ProjectStepFailure;
      unresolvedStep: ProjectStep;
      /** Confirmed id retained despite the error, if any. */
      itemId?: string;
      errors?: readonly string[];
      /** Value found on a conflicting human edit. */
      currentOptionId?: string;
    };

function failure(
  step: ProjectStep,
  error: unknown,
): { ok: false; reason: ProjectStepFailure; unresolvedStep: ProjectStep } {
  if (error instanceof GitHubTransportError) {
    if (error.kind === "forbidden")
      return {
        ok: false,
        reason: "projects_access_denied",
        unresolvedStep: step,
      };
    if (error.kind === "unauthorized")
      return {
        ok: false,
        reason: "projects_credentials_expired",
        unresolvedStep: step,
      };
  }
  return { ok: false, reason: "unavailable", unresolvedStep: step };
}

export interface AddIssueInput {
  operationId: string;
  projectId: string;
  issueNodeId: string;
}

export async function addIssueItem(
  transport: ProjectItemsTransport,
  token: string,
  store: ProjectItemReceiptStore,
  input: AddIssueInput,
): Promise<ProjectStepResult<{ itemId: string; added: boolean }>> {
  const existing = store.get(input.operationId);
  if (existing?.status === "confirmed" && existing.itemId !== undefined)
    return { ok: true, itemId: existing.itemId, added: false };

  const receipt: ProjectItemReceipt = existing ?? {
    operationId: input.operationId,
    step: "add_item",
    projectId: input.projectId,
    contentId: input.issueNodeId,
    status: "pending",
  };
  const confirm = (itemId: string, added: boolean) => {
    store.save({ ...receipt, status: "confirmed", itemId });
    return { ok: true as const, itemId, added };
  };

  try {
    // Reconcile first: an earlier unknown outcome may already have added it.
    const items = await transport.listProjectItems(token, input.projectId);
    const found = items.find((i) => i.contentId === input.issueNodeId);
    if (found) return confirm(found.itemId, false);
    if (!existing) store.save(receipt);
    const res = await transport.addItem(
      token,
      input.projectId,
      input.issueNodeId,
    );
    if (res.itemId !== undefined) {
      const ok = confirm(res.itemId, true);
      if (res.errors?.length)
        return {
          ok: false,
          reason: "partial_error",
          unresolvedStep: "add_item",
          itemId: res.itemId,
          errors: res.errors,
        };
      return ok;
    }
    return {
      ok: false,
      reason: res.errors?.length ? "partial_error" : "unavailable",
      unresolvedStep: "add_item",
      ...(res.errors ? { errors: res.errors } : {}),
    };
  } catch (error) {
    return failure("add_item", error);
  }
}

export interface UpdateStatusInput {
  operationId: string;
  /** Bound Project id; items and fields must belong to it. */
  projectId: string;
  itemId: string;
  mapping: ProjectFieldMapping;
  fieldId: string;
  desiredOptionId: string;
  /**
   * Option the manager last wrote (or observed) for this item. If the live
   * value differs, a human changed it and nothing is overwritten.
   */
  expectedOptionId: string | undefined;
}

export async function updateItemStatus(
  transport: ProjectItemsTransport,
  token: string,
  store: ProjectItemReceiptStore,
  input: UpdateStatusInput,
): Promise<ProjectStepResult<{ updated: boolean }>> {
  const step = "update_field" as const;
  const existing = store.get(input.operationId);
  if (existing?.status === "confirmed") return { ok: true, updated: false };

  if (
    input.fieldId !== input.mapping.statusFieldId ||
    !input.mapping.statusOptionIds.includes(input.desiredOptionId)
  )
    return { ok: false, reason: "unbound_id", unresolvedStep: step };

  const receipt: ProjectItemReceipt = existing ?? {
    operationId: input.operationId,
    step,
    projectId: input.projectId,
    itemId: input.itemId,
    fieldId: input.fieldId,
    desiredOptionId: input.desiredOptionId,
    status: "pending",
  };
  const confirm = (updated: boolean) => {
    store.save({ ...receipt, status: "confirmed" });
    return { ok: true as const, updated };
  };

  try {
    const items = await transport.listProjectItems(token, input.projectId);
    const item = items.find((i) => i.itemId === input.itemId);
    if (!item)
      return { ok: false, reason: "item_not_found", unresolvedStep: step };
    const current = item.fieldValues[input.fieldId];
    if (current === input.desiredOptionId) return confirm(false);
    if (current !== input.expectedOptionId)
      return {
        ok: false,
        reason: "conflict",
        unresolvedStep: step,
        ...(current !== undefined ? { currentOptionId: current } : {}),
      };
    if (!existing) store.save(receipt);
    const res = await transport.updateFieldValue(
      token,
      input.projectId,
      input.itemId,
      input.fieldId,
      input.desiredOptionId,
    );
    if (res.errors?.length)
      return {
        ok: false,
        reason: "partial_error",
        unresolvedStep: step,
        errors: res.errors,
      };
    return confirm(true);
  } catch (error) {
    return failure(step, error);
  }
}
