/** Restart-safe inventory sync: page-atomic commits, overlapping scans, fenced attempts. */
import { GitHubTransportError } from "./client";
import {
  inventoryKey,
  type InventoryItem,
  type InventoryKind,
  type InventoryPage,
  type InventoryRepository,
} from "./issues";
import type { GitHubSyncStore } from "../../storage/github-sync-store.ts";

export type SyncPageFetcher = (
  repository: InventoryRepository,
  cursor: string | null,
  since: string | null,
) => Promise<InventoryPage>;

export interface SyncOptions {
  store: GitHubSyncStore;
  fetchPage: SyncPageFetcher;
  repository: InventoryRepository;
  kind: InventoryKind;
  now?: () => Date;
  maxPages?: number;
  /** Incremental scans restart this far before the last completed watermark. */
  overlapMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export type SyncOutcome =
  | { status: "completed"; pages: number }
  | { status: "deferred"; retryAt: string }
  | {
      status: "incomplete";
      reason: "rate_limited" | "access_denied" | "unavailable" | "page_limit";
      retryAt: string;
      pages: number;
    }
  | { status: "superseded" };

export function syncScope(repositoryId: number, kind: InventoryKind): string {
  return `${repositoryId}:${kind}`;
}

export async function syncInventory(
  options: SyncOptions,
): Promise<SyncOutcome> {
  const { store, fetchPage, repository, kind } = options;
  const now = options.now ?? (() => new Date());
  const maxPages = options.maxPages ?? 100;
  const overlapMs = options.overlapMs ?? 5 * 60_000;
  const base = options.backoffBaseMs ?? 30_000;
  const cap = options.backoffMaxMs ?? 60 * 60_000;
  const scope = syncScope(repository.repositoryId, kind);

  const started = now();
  const attempt = store.beginAttempt(
    scope,
    started.toISOString(),
    started.toISOString(),
  );
  if (!attempt) {
    const retryAt = store.getCheckpoint(scope)?.retryAt;
    return { status: "deferred", retryAt: retryAt ?? started.toISOString() };
  }
  const { fence, checkpoint } = attempt;
  const since = checkpoint.completedSince
    ? new Date(Date.parse(checkpoint.completedSince) - overlapMs).toISOString()
    : null;
  let cursor = checkpoint.pageCursor;
  const seen = new Set<string>();
  let pages = 0;

  const fail = (
    reason: "rate_limited" | "access_denied" | "unavailable" | "page_limit",
  ): SyncOutcome => {
    const failures = checkpoint.failures + 1;
    const delay = Math.min(cap, base * 2 ** Math.min(failures - 1, 20));
    const retryAt = new Date(now().getTime() + delay).toISOString();
    if (!store.fail(scope, fence, reason, retryAt, failures))
      return { status: "superseded" };
    return { status: "incomplete", reason, retryAt, pages };
  };

  for (;;) {
    if (pages >= maxPages) return fail("page_limit");
    let page: InventoryPage;
    try {
      page = await fetchPage(repository, cursor, since);
    } catch (error) {
      return fail(
        error instanceof GitHubTransportError && error.kind === "forbidden"
          ? "access_denied"
          : "unavailable",
      );
    }
    pages += 1;
    const observedAt = now().toISOString();
    const byKey = new Map<string, InventoryItem>();
    for (const record of page.items) {
      if ((record.isPullRequest === true) !== (kind === "pull_request"))
        continue;
      const key = inventoryKey(repository.repositoryId, kind, record.number);
      const existing = byKey.get(key);
      if (
        existing &&
        Date.parse(existing.updatedAt) > Date.parse(record.updatedAt)
      )
        continue;
      byKey.set(key, {
        key,
        kind,
        repositoryId: repository.repositoryId,
        repositoryFullName: repository.fullName,
        id: record.id,
        number: record.number,
        url: record.url,
        title: record.title,
        state: record.state,
        updatedAt: record.updatedAt,
        observedAt,
      });
    }
    const next = page.nextCursor ?? null;
    if (next !== null && seen.has(next)) return fail("unavailable");
    if (next !== null) seen.add(next);
    // Page items and the resume cursor commit together; completion is separate.
    if (!store.commitPage(scope, fence, [...byKey.values()], next))
      return { status: "superseded" };
    if (page.rateLimited === true) return fail("rate_limited");
    if (next === null) break;
    cursor = next;
  }
  if (!store.complete(scope, fence, now().toISOString()))
    return { status: "superseded" };
  return { status: "completed", pages };
}
