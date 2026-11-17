import { describe, expect, it } from "vitest";
import {
  createMissingProject,
  type ProjectCreateReceipt,
  type ProjectCreateReceiptStore,
  type ProjectCreateTransport,
} from "./project-create.ts";
import type { ProjectSummary } from "./projects.ts";

const input = { operationId: "op1", repositoryId: 1, title: "Board" };
const made: ProjectSummary = {
  id: "P_new",
  number: 2,
  title: "Board",
  ownerLogin: "me",
};

function fixture(remote: ProjectSummary[] = [], bound = false) {
  const receipts = new Map<string, ProjectCreateReceipt>();
  const store: ProjectCreateReceiptStore = {
    get: (id) => receipts.get(id),
    save: (r) => void receipts.set(r.operationId, r),
    hasBinding: () => bound,
  };
  let creates = 0;
  let loseResponse = false;
  const transport: ProjectCreateTransport = {
    listOwnerProjects: async () => [...remote],
    createProject: async () => {
      creates++;
      remote.push(made);
      if (loseResponse) throw new Error("lost response");
      return made;
    },
  };
  return {
    store,
    transport,
    receipts,
    remote,
    creates: () => creates,
    lose: () => (loseResponse = true),
  };
}

describe("createMissingProject", () => {
  it("creates and stores the confirmed project id", async () => {
    const f = fixture();
    const r = await createMissingProject(f.transport, "t", f.store, input);
    expect(r).toMatchObject({ ok: true, projectId: "P_new", created: true });
    expect(f.receipts.get("op1")).toMatchObject({
      status: "confirmed",
      projectId: "P_new",
    });
    await createMissingProject(f.transport, "t", f.store, input);
    expect(f.creates()).toBe(1);
  });

  it("reconciles a lost response instead of duplicating", async () => {
    const f = fixture();
    f.lose();
    const first = await createMissingProject(f.transport, "t", f.store, input);
    expect(first).toMatchObject({ ok: false, reason: "unavailable" });
    expect(f.receipts.get("op1")?.status).toBe("pending");
    const second = await createMissingProject(f.transport, "t", f.store, input);
    expect(second).toMatchObject({ ok: true, created: false });
    expect(f.creates()).toBe(1);
  });

  it("retries when reconciliation finds nothing", async () => {
    const f = fixture();
    f.receipts.set("op1", {
      ...input,
      baselineProjectIds: [],
      status: "pending",
    });
    const r = await createMissingProject(f.transport, "t", f.store, input);
    expect(r).toMatchObject({ ok: true, created: true });
  });

  it("stops as ambiguous on multiple matches", async () => {
    const f = fixture([
      { ...made, id: "A" },
      { ...made, id: "B" },
    ]);
    f.receipts.set("op1", {
      ...input,
      baselineProjectIds: [],
      status: "pending",
    });
    const r = await createMissingProject(f.transport, "t", f.store, input);
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(f.creates()).toBe(0);
  });

  it("never recreates an adopted board or an existing title", async () => {
    const bound = fixture([], true);
    expect(
      await createMissingProject(bound.transport, "t", bound.store, input),
    ).toMatchObject({ ok: false, reason: "already_bound" });
    const titled = fixture([{ ...made, id: "X" }]);
    expect(
      await createMissingProject(titled.transport, "t", titled.store, input),
    ).toMatchObject({ ok: false, reason: "title_exists" });
    expect(bound.creates() + titled.creates()).toBe(0);
  });
});
