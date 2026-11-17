import { describe, expect, it } from "vitest";
import { GitHubTransportError } from "./client";
import {
  fetchCheckObservations,
  type CheckPage,
  type CheckRecord,
  type ObservedPullRef,
} from "./checks";
import {
  fetchReviewObservations,
  type ReviewPage,
  type ReviewRecord,
} from "./reviews";

const NOW = new Date("2025-01-01T00:00:00Z");
const pullA: ObservedPullRef = {
  repositoryId: 1,
  repositoryFullName: "acme/agents",
  number: 7,
  headSha: "new",
};
const pullB: ObservedPullRef = {
  repositoryId: 2,
  repositoryFullName: "acme/design",
  number: 7,
  headSha: "new",
};

function check(id: number, extra: Partial<CheckRecord> = {}): CheckRecord {
  return {
    id,
    name: `c${id}`,
    status: "completed",
    conclusion: "success",
    headSha: "new",
    url: `https://github.com/acme/x/runs/${id}`,
    actor: "ci-app",
    timestamp: "2024-12-31T00:00:00Z",
    ...extra,
  };
}

function review(id: number, extra: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id,
    state: "APPROVED",
    commitSha: "new",
    reviewer: "alice",
    url: `https://github.com/acme/x/pull/7#review-${id}`,
    submittedAt: "2024-12-31T00:00:00Z",
    ...extra,
  };
}

function paged<T>(list: T[]) {
  let i = 0;
  return async (): Promise<T> => list[i++] as T;
}

describe("check observations", () => {
  it("retains stale-head provenance and excludes it from the aggregate", async () => {
    const result = await fetchCheckObservations({
      pull: pullA,
      now: () => NOW,
      fetchPage: paged<CheckPage>([
        {
          items: [
            check(1, { headSha: "old" }),
            check(2, { conclusion: "failure" }),
          ],
        },
      ]),
    });
    expect(result.complete).toBe(true);
    const stale = result.observations.find((o) => o.name === "c1");
    expect(stale).toMatchObject({
      stale: true,
      headSha: "old",
      currentHeadSha: "new",
      state: "pass",
      actor: "ci-app",
      url: "https://github.com/acme/x/runs/1",
      timestamp: "2024-12-31T00:00:00Z",
    });
    expect(result.aggregate).toBe("fail");
  });

  it("does not pass when only stale checks passed", async () => {
    const result = await fetchCheckObservations({
      pull: pullA,
      fetchPage: paged<CheckPage>([{ items: [check(1, { headSha: "old" })] }]),
    });
    expect(result.aggregate).toBe("unknown");
  });

  it("reports conflicting sources without collapsing them", async () => {
    const result = await fetchCheckObservations({
      pull: pullA,
      fetchPage: paged<CheckPage>([
        {
          items: [
            check(1, { name: "build" }),
            check(2, { name: "build", conclusion: "failure", actor: "other" }),
          ],
        },
      ]),
    });
    expect(result.observations).toHaveLength(2);
    expect(result.aggregate).toBe("fail");
  });

  it("is unknown/incomplete on missing permission or partial pages", async () => {
    const denied = await fetchCheckObservations({
      pull: pullA,
      fetchPage: async () => {
        throw new GitHubTransportError("forbidden");
      },
    });
    expect(denied).toMatchObject({
      complete: false,
      reason: "access_denied",
      aggregate: "unknown",
    });

    const partial = await fetchCheckObservations({
      pull: pullA,
      fetchPage: paged<CheckPage>([
        { items: [check(1)], nextCursor: "p2" },
        { items: [], rateLimited: true },
      ]),
    });
    expect(partial).toMatchObject({
      complete: false,
      reason: "rate_limited",
      aggregate: "unknown",
    });
    expect(partial.observations).toHaveLength(1);
  });

  it("keeps identical PR numbers in different repos distinct", async () => {
    const a = await fetchCheckObservations({
      pull: pullA,
      fetchPage: paged<CheckPage>([{ items: [check(1)] }]),
    });
    const b = await fetchCheckObservations({
      pull: pullB,
      fetchPage: paged<CheckPage>([{ items: [check(1)] }]),
    });
    expect(a.observations[0]?.key).not.toBe(b.observations[0]?.key);
    expect(b.observations[0]?.repositoryFullName).toBe("acme/design");
  });
});

describe("review observations", () => {
  it("retains dismissed and stale reviews with provenance", async () => {
    const result = await fetchReviewObservations({
      pull: pullA,
      now: () => NOW,
      fetchPage: paged<ReviewPage>([
        {
          items: [
            review(1, { state: "DISMISSED", commitSha: "old" }),
            review(2, { state: "CHANGES_REQUESTED" }),
          ],
        },
      ]),
    });
    expect(result.complete).toBe(true);
    expect(result.observations[0]).toMatchObject({
      state: "dismissed",
      stale: true,
      headSha: "old",
      reviewer: "alice",
      url: "https://github.com/acme/x/pull/7#review-1",
    });
    expect(result.observations[1]).toMatchObject({
      state: "changes_requested",
      stale: false,
    });
  });

  it("is incomplete on denied access and keeps repos distinct", async () => {
    const denied = await fetchReviewObservations({
      pull: pullA,
      fetchPage: async () => {
        throw new GitHubTransportError("forbidden");
      },
    });
    expect(denied).toMatchObject({ complete: false, reason: "access_denied" });

    const a = await fetchReviewObservations({
      pull: pullA,
      fetchPage: paged<ReviewPage>([{ items: [review(1)] }]),
    });
    const b = await fetchReviewObservations({
      pull: pullB,
      fetchPage: paged<ReviewPage>([{ items: [review(1)] }]),
    });
    expect(a.observations[0]?.key).not.toBe(b.observations[0]?.key);
  });

  it("treats unrecognised states as unknown", async () => {
    const result = await fetchReviewObservations({
      pull: pullA,
      fetchPage: paged<ReviewPage>([
        { items: [review(1, { state: "WEIRD" })] },
      ]),
    });
    expect(result.observations[0]?.state).toBe("unknown");
  });
});
