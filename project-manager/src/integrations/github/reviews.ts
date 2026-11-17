/** Maps provider PR reviews into source-linked observations. Transport is injected. */
import { GitHubTransportError } from "./client";
import { pullObservationKey } from "./checks";
import type { ObservationIncompleteReason, ObservedPullRef } from "./checks";

export interface ReviewRecord {
  id: number;
  /** Provider state: APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING. */
  state: string;
  /** Commit the review was submitted against. */
  commitSha: string | null;
  reviewer: string | null;
  url: string;
  /** ISO-8601 submission time. */
  submittedAt: string | null;
}

export interface ReviewPage {
  items: readonly ReviewRecord[];
  nextCursor?: string | null;
  rateLimited?: boolean;
}

export type ReviewPageFetcher = (
  pull: ObservedPullRef,
  cursor: string | null,
) => Promise<ReviewPage>;

export type ReviewObservationState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed"
  | "pending"
  | "unknown";

export interface ReviewObservation {
  key: string;
  source: "github_review";
  repositoryId: number;
  repositoryFullName: string;
  pullNumber: number;
  /** Commit the review was really made on (null if provider omitted it). */
  headSha: string | null;
  currentHeadSha: string;
  /** True unless the review's commit is known to equal the current head. */
  stale: boolean;
  /** Dismissed reviews are retained with their dismissed state, not dropped. */
  state: ReviewObservationState;
  reviewer: string | null;
  url: string;
  timestamp: string | null;
  observedAt: string;
}

export type ReviewObservationResult =
  | {
      complete: true;
      observations: readonly ReviewObservation[];
      pages: number;
    }
  | {
      complete: false;
      reason: ObservationIncompleteReason;
      observations: readonly ReviewObservation[];
      pages: number;
    };

export interface FetchReviewOptions {
  fetchPage: ReviewPageFetcher;
  pull: ObservedPullRef;
  now?: () => Date;
  maxPages?: number;
}

export function mapReviewState(state: string): ReviewObservationState {
  switch (state.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    case "DISMISSED":
      return "dismissed";
    case "PENDING":
      return "pending";
    default:
      return "unknown";
  }
}

export function mapReviewRecord(
  pull: ObservedPullRef,
  record: ReviewRecord,
  observedAt: string,
): ReviewObservation {
  return {
    key: pullObservationKey(pull, "review", record.id),
    source: "github_review",
    repositoryId: pull.repositoryId,
    repositoryFullName: pull.repositoryFullName,
    pullNumber: pull.number,
    headSha: record.commitSha,
    currentHeadSha: pull.headSha,
    stale: record.commitSha !== pull.headSha,
    state: mapReviewState(record.state),
    reviewer: record.reviewer,
    url: record.url,
    timestamp: record.submittedAt,
    observedAt,
  };
}

export async function fetchReviewObservations(
  options: FetchReviewOptions,
): Promise<ReviewObservationResult> {
  const { fetchPage, pull } = options;
  const now = options.now ?? (() => new Date());
  const maxPages = options.maxPages ?? 100;
  const byKey = new Map<string, ReviewObservation>();
  const seenCursors = new Set<string>();
  let pages = 0;
  let cursor: string | null = null;

  const incomplete = (
    reason: ObservationIncompleteReason,
  ): ReviewObservationResult => ({
    complete: false,
    reason,
    observations: [...byKey.values()],
    pages,
  });

  for (;;) {
    if (pages >= maxPages) return incomplete("page_limit");
    let page: ReviewPage;
    try {
      page = await fetchPage(pull, cursor);
    } catch (error) {
      if (error instanceof GitHubTransportError && error.kind === "forbidden") {
        return incomplete("access_denied");
      }
      return incomplete("unavailable");
    }
    pages += 1;
    const observedAt = now().toISOString();
    for (const record of page.items) {
      const mapped = mapReviewRecord(pull, record, observedAt);
      byKey.set(mapped.key, mapped);
    }
    if (page.rateLimited === true) return incomplete("rate_limited");
    const next = page.nextCursor ?? null;
    if (next === null) {
      return { complete: true, observations: [...byKey.values()], pages };
    }
    if (seenCursors.has(next)) return incomplete("unavailable");
    seenCursors.add(next);
    cursor = next;
  }
}
