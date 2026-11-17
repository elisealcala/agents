import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { GitHubTransportError } from "./client";
import type { InventoryPage, InventoryRecord } from "./issues";
import { syncInventory, syncScope, type SyncPageFetcher } from "./sync";
import { GitHubSyncStore } from "../../storage/github-sync-store.ts";
import { createNodeSqlDriver } from "../../storage/sql-driver.ts";

const repository = { repositoryId: 1, fullName: "acme/agents" };
const scope = syncScope(1, "issue");

function rec(n: number, updatedAt = "2025-01-01T00:00:00Z"): InventoryRecord {
  return {
    id: n,
    number: n,
    url: `u${n}`,
    title: `t${n}`,
    state: "open",
    updatedAt,
  };
}
function pages(map: Record<string, InventoryPage>): SyncPageFetcher {
  return async (_r, cursor) => {
    const page = map[cursor ?? ""];
    if (!page) throw new GitHubTransportError("unavailable");
    return page;
  };
}
function setup() {
  const db = createNodeSqlDriver(new DatabaseSync(":memory:"));
  let time = Date.parse("2025-02-01T00:00:00Z");
  return {
    db,
    store: new GitHubSyncStore(db),
    now: () => new Date(time),
    advance: (ms: number) => (time += ms),
  };
}

describe("syncInventory", () => {
  it("resumes after a partial failure without advancing the completed cursor or duplicating", async () => {
    const s = setup();
    const run = (fetchPage: SyncPageFetcher) =>
      syncInventory({
        store: s.store,
        fetchPage,
        repository,
        kind: "issue",
        now: s.now,
      });
    const first = await run(
      pages({ "": { items: [rec(1)], nextCursor: "p2" } }),
    );
    expect(first.status).toBe("incomplete");
    const cp = s.store.getCheckpoint(scope);
    expect(cp?.completedSince).toBeNull();
    expect(cp?.pageCursor).toBe("p2");
    expect(s.store.listObservations(scope)).toHaveLength(1);

    s.advance(60 * 60_000);
    const seen: (string | null)[] = [];
    const second = await run(async (_r, cursor) => {
      seen.push(cursor);
      return { items: [rec(2)], nextCursor: null };
    });
    expect(seen).toEqual(["p2"]);
    expect(second.status).toBe("completed");
    expect(s.store.listObservations(scope).map((i) => i.number)).toEqual([
      1, 2,
    ]);
    expect(s.store.getCheckpoint(scope)?.completedSince).not.toBeNull();
  });

  it("keeps last-known state on revocation and defers within backoff", async () => {
    const s = setup();
    const base = {
      store: s.store,
      repository,
      kind: "issue" as const,
      now: s.now,
    };
    await syncInventory({
      ...base,
      fetchPage: pages({ "": { items: [rec(1)] } }),
    });
    s.advance(1000);
    const denied = await syncInventory({
      ...base,
      fetchPage: async () => {
        throw new GitHubTransportError("forbidden");
      },
    });
    expect(denied).toMatchObject({
      status: "incomplete",
      reason: "access_denied",
    });
    expect(s.store.listObservations(scope)).toHaveLength(1);
    const again = await syncInventory({
      ...base,
      fetchPage: pages({ "": { items: [] } }),
    });
    expect(again.status).toBe("deferred");
  });

  it("bounds backoff and uses overlapping since on incremental scans", async () => {
    const s = setup();
    const base = {
      store: s.store,
      repository,
      kind: "issue" as const,
      now: s.now,
      backoffBaseMs: 1000,
      backoffMaxMs: 3000,
    };
    for (let i = 0; i < 5; i++) {
      s.advance(10_000);
      await syncInventory({
        ...base,
        fetchPage: async () => ({ items: [], rateLimited: true }),
      });
    }
    const cp = s.store.getCheckpoint(scope);
    expect(Date.parse(cp?.retryAt ?? "") - s.now().getTime()).toBe(3000);
    s.advance(10_000);
    await syncInventory({ ...base, fetchPage: pages({ "": { items: [] } }) });
    s.advance(10_000);
    let since: string | null = null;
    await syncInventory({
      ...base,
      fetchPage: async (_r, _c, s2) => {
        since = s2;
        return { items: [] };
      },
    });
    expect(since).not.toBeNull();
    expect(Date.parse(since ?? "")).toBeLessThan(
      Date.parse(s.store.getCheckpoint(scope)?.completedSince ?? ""),
    );
  });

  it("fences out a superseded attempt", () => {
    const s = setup();
    const a = s.store.beginAttempt(scope, "2025-02-01T00:00:00Z", "t");
    const b = s.store.beginAttempt(scope, "2025-02-01T00:00:01Z", "t");
    expect(a && b && b.fence > a.fence).toBe(true);
    expect(s.store.commitPage(scope, a?.fence ?? 0, [], "x")).toBe(false);
  });
});
