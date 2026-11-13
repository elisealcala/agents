import { describe, expect, it } from "vitest";
import { GitHubTransportError } from "./client";
import {
  fetchIssueInventory,
  type InventoryPage,
  type InventoryPageFetcher,
  type InventoryRecord,
} from "./issues";
import { fetchPullInventory } from "./pulls";

const NOW = new Date("2025-01-01T00:00:00Z");
const repoA = { repositoryId: 1, fullName: "acme/agents" };
const repoB = { repositoryId: 2, fullName: "acme/design" };

function rec(
  number: number,
  extra: Partial<InventoryRecord> = {},
): InventoryRecord {
  return {
    id: 1000 + number,
    number,
    url: `https://github.com/acme/x/issues/${number}`,
    title: `t${number}`,
    state: "open",
    updatedAt: "2024-12-01T00:00:00Z",
    ...extra,
  };
}

function pages(list: InventoryPage[]): InventoryPageFetcher {
  return async (_repo, cursor) => {
    const index = cursor === null ? 0 : Number(cursor);
    const page = list[index];
    if (!page) throw new Error("no page");
    return page;
  };
}

describe("inventory", () => {
  it("dedupes overlapping records across pages", async () => {
    const result = await fetchIssueInventory({
      repository: repoA,
      now: () => NOW,
      fetchPage: pages([
        { items: [rec(1), rec(2)], nextCursor: "1" },
        {
          items: [
            rec(2, { title: "newer", updatedAt: "2024-12-02T00:00:00Z" }),
            rec(3),
          ],
        },
      ]),
    });
    expect(result.complete).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.items.map((i) => i.number)).toEqual([1, 2, 3]);
    expect(result.items[1]?.title).toBe("newer");
    expect(result.items[0]?.observedAt).toBe(NOW.toISOString());
    expect(result.items[0]?.url).toContain("/issues/1");
  });

  it("does not collide on equal numbers in different repositories", async () => {
    const fetchPage = pages([{ items: [rec(7)] }]);
    const a = await fetchIssueInventory({ repository: repoA, fetchPage });
    const b = await fetchIssueInventory({ repository: repoB, fetchPage });
    const keys = new Set([...a.items, ...b.items].map((i) => i.key));
    expect(keys.size).toBe(2);
  });

  it("separates issues from pull requests", async () => {
    const fetchPage = pages([
      { items: [rec(1), rec(2, { isPullRequest: true })] },
    ]);
    const issues = await fetchIssueInventory({ repository: repoA, fetchPage });
    const prs = await fetchPullInventory({ repository: repoA, fetchPage });
    expect(issues.items.map((i) => i.number)).toEqual([1]);
    expect(prs.items.map((i) => [i.number, i.kind])).toEqual([
      [2, "pull_request"],
    ]);
  });

  it("returns incomplete when rate limited", async () => {
    const result = await fetchIssueInventory({
      repository: repoA,
      fetchPage: pages([
        { items: [rec(1)], nextCursor: "1", rateLimited: true },
      ]),
    });
    expect(result).toMatchObject({ complete: false, reason: "rate_limited" });
    expect(result.items).toHaveLength(1);
  });

  it("returns incomplete when a later page fails", async () => {
    const result = await fetchPullInventory({
      repository: repoA,
      fetchPage: async (_r, cursor) => {
        if (cursor === null) {
          return {
            items: [rec(1, { isPullRequest: true })],
            nextCursor: "1",
          };
        }
        throw new GitHubTransportError("forbidden");
      },
    });
    expect(result).toMatchObject({ complete: false, reason: "access_denied" });
    expect(result.items).toHaveLength(1);
  });

  it("stops on cursor loops and page limit", async () => {
    const loop = await fetchIssueInventory({
      repository: repoA,
      fetchPage: async () => ({ items: [rec(1)], nextCursor: "x" }),
    });
    expect(loop.complete).toBe(false);
    const limited = await fetchIssueInventory({
      repository: repoA,
      maxPages: 1,
      fetchPage: async () => ({ items: [rec(1)], nextCursor: "y" }),
    });
    expect(limited).toMatchObject({ complete: false, reason: "page_limit" });
  });
});
