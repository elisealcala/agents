import { describe, expect, it } from "vitest";
import {
  ensureManagerField,
  type ProjectFieldReceipt,
  type ProjectFieldsTransport,
} from "./project-fields.ts";
import {
  addIssueItem,
  updateItemStatus,
  type ProjectItem,
  type ProjectItemReceipt,
  type ProjectItemsTransport,
} from "./project-items.ts";
import type { ProjectField } from "./projects.ts";

const made: ProjectField = {
  id: "F1",
  name: "Manager",
  type: "single_select",
  options: [{ id: "O1", name: "Todo" }],
};

describe("ensureManagerField", () => {
  function fixture() {
    const remote: ProjectField[] = [];
    const receipts = new Map<string, ProjectFieldReceipt>();
    let creates = 0;
    let lose = false;
    const transport: ProjectFieldsTransport = {
      listProjectFields: async () => [...remote],
      createSingleSelectField: async () => {
        creates++;
        remote.push(made);
        if (lose) throw new Error("lost");
        return made;
      },
    };
    const store = {
      get: (id: string) => receipts.get(id),
      save: (r: ProjectFieldReceipt) => void receipts.set(r.operationId, r),
    };
    return {
      transport,
      store,
      creates: () => creates,
      lose: () => (lose = true),
    };
  }
  const input = {
    operationId: "f",
    projectId: "P",
    name: "Manager",
    options: ["Todo"],
  };

  it("creates once and resumes after a lost response", async () => {
    const f = fixture();
    f.lose();
    const first = await ensureManagerField(f.transport, "t", f.store, input);
    expect(first).toMatchObject({ ok: false, unresolvedStep: "create_field" });
    const second = await ensureManagerField(f.transport, "t", f.store, input);
    expect(second).toMatchObject({ ok: true, fieldId: "F1", created: false });
    expect(f.creates()).toBe(1);
  });
});

describe("project items", () => {
  const mapping = { statusFieldId: "S", statusOptionIds: ["a", "b"] };

  function fixture() {
    const items: ProjectItem[] = [];
    const receipts = new Map<string, ProjectItemReceipt>();
    const calls = { add: 0, update: 0 };
    let addResponse:
      | { itemId?: string; errors?: string[] }
      | "lose"
      | undefined;
    const transport: ProjectItemsTransport = {
      listProjectItems: async () => [...items],
      addItem: async (_t, _p, contentId) => {
        calls.add++;
        items.push({ itemId: "I1", contentId, fieldValues: {} });
        if (addResponse === "lose") throw new Error("lost");
        return addResponse ?? { itemId: "I1" };
      },
      updateFieldValue: async (_t, _p, itemId, fieldId, optionId) => {
        calls.update++;
        const i = items.findIndex((x) => x.itemId === itemId);
        items[i] = {
          ...items[i],
          fieldValues: { ...items[i].fieldValues, [fieldId]: optionId },
        };
        return {};
      },
    };
    const store = {
      get: (id: string) => receipts.get(id),
      save: (r: ProjectItemReceipt) => void receipts.set(r.operationId, r),
    };
    return {
      items,
      receipts,
      calls,
      transport,
      store,
      respond: (r: typeof addResponse) => (addResponse = r),
    };
  }
  const add = { operationId: "a", projectId: "P", issueNodeId: "N" };
  const upd = {
    operationId: "u",
    projectId: "P",
    itemId: "I1",
    mapping,
    fieldId: "S",
    desiredOptionId: "b",
    expectedOptionId: "a" as string | undefined,
  };

  it("does not duplicate an item after a lost response", async () => {
    const f = fixture();
    f.respond("lose");
    expect(await addIssueItem(f.transport, "t", f.store, add)).toMatchObject({
      ok: false,
      unresolvedStep: "add_item",
    });
    f.respond(undefined);
    expect(await addIssueItem(f.transport, "t", f.store, add)).toMatchObject({
      ok: true,
      itemId: "I1",
      added: false,
    });
    expect(f.calls.add).toBe(1);
  });

  it("keeps the confirmed receipt on a GraphQL partial error", async () => {
    const f = fixture();
    f.respond({ itemId: "I1", errors: ["field boom"] });
    const r = await addIssueItem(f.transport, "t", f.store, add);
    expect(r).toMatchObject({
      ok: false,
      reason: "partial_error",
      unresolvedStep: "add_item",
      itemId: "I1",
    });
    expect(f.receipts.get("a")).toMatchObject({
      status: "confirmed",
      itemId: "I1",
    });
  });

  it("updates with bound ids and skips when already applied", async () => {
    const f = fixture();
    f.items.push({ itemId: "I1", contentId: "N", fieldValues: { S: "a" } });
    expect(await updateItemStatus(f.transport, "t", f.store, upd)).toEqual({
      ok: true,
      updated: true,
    });
    await updateItemStatus(f.transport, "t", f.store, upd);
    expect(f.calls.update).toBe(1);
  });

  it("rejects ids outside the binding", async () => {
    const f = fixture();
    const r = await updateItemStatus(f.transport, "t", f.store, {
      ...upd,
      fieldId: "other",
    });
    expect(r).toMatchObject({ ok: false, reason: "unbound_id" });
    expect(f.calls.update).toBe(0);
  });

  it("detects a human edit and does not overwrite it", async () => {
    const f = fixture();
    f.items.push({ itemId: "I1", contentId: "N", fieldValues: { S: "x" } });
    const r = await updateItemStatus(f.transport, "t", f.store, upd);
    expect(r).toMatchObject({
      ok: false,
      reason: "conflict",
      currentOptionId: "x",
    });
    expect(f.calls.update).toBe(0);
  });
});
