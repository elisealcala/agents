/** Maps provider check runs for an observed PR into source-linked observations. Transport is injected. */
import { GitHubTransportError } from "./client";

/** The observed PR. Number is repository-local, so identity always includes the repository id. */
export interface ObservedPullRef {
  repositoryId: number;
  repositoryFullName: string;
  number: number;
  /** Head SHA of the PR at observation time. */
  headSha: string;
}

export interface CheckRecord {
  id: number;
  name: string;
  /** Provider status, e.g. queued | in_progress | completed. */
  status: string;
  /** Provider conclusion; null until completed. */
  conclusion: string | null;
  /** SHA the check actually ran against. */
  headSha: string;
  url: string;
  /** Check app / actor login or slug. */
  actor: string | null;
  /** ISO-8601 completion (or start) time. */
  timestamp: string | null;
}

export interface CheckPage {
  items: readonly CheckRecord[];
  nextCursor?: string | null;
  rateLimited?: boolean;
}

export type CheckPageFetcher = (
  pull: ObservedPullRef,
  cursor: string | null,
) => Promise<CheckPage>;

export type ObservationState = "pass" | "fail" | "pending" | "unknown";

export interface CheckObservation {
  /** Stable identity: repository id + PR number + check id. */
  key: string;
  source: "github_check";
  repositoryId: number;
  repositoryFullName: string;
  pullNumber: number;
  /** Head SHA the check really ran on (real provenance). */
  headSha: string;
  /** Current PR head at observation time. */
  currentHeadSha: string;
  /** True when the check ran on an older head than the PR's current one. */
  stale: boolean;
  name: string;
  state: ObservationState;
  actor: string | null;
  url: string;
  timestamp: string | null;
  observedAt: string;
}

export type ObservationIncompleteReason =
  | "rate_limited"
  | "access_denied"
  | "unavailable"
  | "page_limit";

export type CheckObservationResult =
  | {
      complete: true;
      observations: readonly CheckObservation[];
      /** Aggregate of current-head checks; pass only when complete and every current check passed. */
      aggregate: ObservationState;
      pages: number;
    }
  | {
      complete: false;
      reason: ObservationIncompleteReason;
      observations: readonly CheckObservation[];
      aggregate: "unknown";
      pages: number;
    };

export interface FetchCheckOptions {
  fetchPage: CheckPageFetcher;
  pull: ObservedPullRef;
  now?: () => Date;
  maxPages?: number;
}

export function pullObservationKey(
  pull: Pick<ObservedPullRef, "repositoryId" | "number">,
  source: string,
  id: number,
): string {
  return `${pull.repositoryId}:pull:${pull.number}:${source}:${id}`;
}

export function mapCheckState(
  status: string,
  conclusion: string | null,
): ObservationState {
  if (status !== "completed") {
    return status === "queued" || status === "in_progress"
      ? "pending"
      : "unknown";
  }
  switch (conclusion) {
    case "success":
      return "pass";
    case "failure":
    case "timed_out":
    case "cancelled":
    case "action_required":
    case "startup_failure":
      return "fail";
    default:
      // neutral/skipped/stale/null/unrecognised: never treated as pass.
      return "unknown";
  }
}

export function mapCheckRecord(
  pull: ObservedPullRef,
  record: CheckRecord,
  observedAt: string,
): CheckObservation {
  return {
    key: pullObservationKey(pull, "check", record.id),
    source: "github_check",
    repositoryId: pull.repositoryId,
    repositoryFullName: pull.repositoryFullName,
    pullNumber: pull.number,
    headSha: record.headSha,
    currentHeadSha: pull.headSha,
    stale: record.headSha !== pull.headSha,
    name: record.name,
    state: mapCheckState(record.status, record.conclusion),
    actor: record.actor,
    url: record.url,
    timestamp: record.timestamp,
    observedAt,
  };
}

function aggregateChecks(
  observations: readonly CheckObservation[],
): ObservationState {
  const current = observations.filter((o) => !o.stale);
  if (current.length === 0) return "unknown";
  if (current.some((o) => o.state === "fail")) return "fail";
  if (current.some((o) => o.state === "unknown")) return "unknown";
  if (current.some((o) => o.state === "pending")) return "pending";
  return "pass";
}

export async function fetchCheckObservations(
  options: FetchCheckOptions,
): Promise<CheckObservationResult> {
  const { fetchPage, pull } = options;
  const now = options.now ?? (() => new Date());
  const maxPages = options.maxPages ?? 100;
  const byKey = new Map<string, CheckObservation>();
  const seenCursors = new Set<string>();
  let pages = 0;
  let cursor: string | null = null;

  const incomplete = (
    reason: ObservationIncompleteReason,
  ): CheckObservationResult => ({
    complete: false,
    reason,
    observations: [...byKey.values()],
    aggregate: "unknown",
    pages,
  });

  for (;;) {
    if (pages >= maxPages) return incomplete("page_limit");
    let page: CheckPage;
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
      const mapped = mapCheckRecord(pull, record, observedAt);
      byKey.set(mapped.key, mapped);
    }
    if (page.rateLimited === true) return incomplete("rate_limited");
    const next = page.nextCursor ?? null;
    if (next === null) {
      const observations = [...byKey.values()];
      return {
        complete: true,
        observations,
        aggregate: aggregateChecks(observations),
        pages,
      };
    }
    if (seenCursors.has(next)) return incomplete("unavailable");
    seenCursors.add(next);
    cursor = next;
  }
}
