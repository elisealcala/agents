/** Paginated issue/PR inventory for one explicitly authorized repository. Transport is injected. */
import { GitHubTransportError } from "./client";

export type InventoryKind = "issue" | "pull_request";

/** One provider record as returned by a page fetcher. */
export interface InventoryRecord {
  /** Provider numeric id; stable across renames and transfers. */
  id: number;
  /** Repository-local number; NOT unique across repositories. */
  number: number;
  url: string;
  title: string;
  state: string;
  /** ISO-8601 provider update time. */
  updatedAt: string;
  /** The issues endpoint also returns PRs; flag them so they are not double counted. */
  isPullRequest?: boolean;
}

export interface InventoryPage {
  items: readonly InventoryRecord[];
  /** Opaque cursor for the next page; absent/null on the last page. */
  nextCursor?: string | null;
  /** Provider signalled a rate limit; items on this page are still usable. */
  rateLimited?: boolean;
}

export interface InventoryRepository {
  repositoryId: number;
  fullName: string;
}

export type InventoryPageFetcher = (
  repository: InventoryRepository,
  cursor: string | null,
) => Promise<InventoryPage>;

export interface InventoryItem {
  /** Stable identity: repository id + kind + number. Never collides across repositories. */
  key: string;
  kind: InventoryKind;
  repositoryId: number;
  repositoryFullName: string;
  id: number;
  number: number;
  url: string;
  title: string;
  state: string;
  updatedAt: string;
  /** ISO-8601 time the record was observed. */
  observedAt: string;
}

export type InventoryIncompleteReason =
  | "rate_limited"
  | "access_denied"
  | "unavailable"
  | "page_limit";

export type InventoryResult =
  | { complete: true; items: readonly InventoryItem[]; pages: number }
  | {
      complete: false;
      reason: InventoryIncompleteReason;
      items: readonly InventoryItem[];
      pages: number;
    };

export interface FetchInventoryOptions {
  fetchPage: InventoryPageFetcher;
  repository: InventoryRepository;
  now?: () => Date;
  maxPages?: number;
}

export function inventoryKey(
  repositoryId: number,
  kind: InventoryKind,
  number: number,
): string {
  return `${repositoryId}:${kind}:${number}`;
}

/** Shared pagination/dedup core used by issues and pulls. */
export async function fetchInventory(
  kind: InventoryKind,
  options: FetchInventoryOptions,
): Promise<InventoryResult> {
  const { fetchPage, repository } = options;
  const now = options.now ?? (() => new Date());
  const maxPages = options.maxPages ?? 100;
  const byKey = new Map<string, InventoryItem>();
  const seenCursors = new Set<string>();
  let pages = 0;
  let cursor: string | null = null;

  const result = (
    reason: InventoryIncompleteReason | null,
  ): InventoryResult => {
    const items = [...byKey.values()];
    return reason === null
      ? { complete: true, items, pages }
      : { complete: false, reason, items, pages };
  };

  for (;;) {
    if (pages >= maxPages) return result("page_limit");
    let page: InventoryPage;
    try {
      page = await fetchPage(repository, cursor);
    } catch (error) {
      if (error instanceof GitHubTransportError) {
        if (error.kind === "forbidden") return result("access_denied");
      }
      return result("unavailable");
    }
    pages += 1;
    const observedAt = now().toISOString();
    for (const record of page.items) {
      if ((record.isPullRequest === true) !== (kind === "pull_request")) {
        continue;
      }
      const key = inventoryKey(repository.repositoryId, kind, record.number);
      const existing = byKey.get(key);
      if (
        existing &&
        Date.parse(existing.updatedAt) > Date.parse(record.updatedAt)
      ) {
        continue;
      }
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
    if (page.rateLimited === true) return result("rate_limited");
    const next = page.nextCursor ?? null;
    if (next === null) return result(null);
    if (seenCursors.has(next)) return result("unavailable");
    seenCursors.add(next);
    cursor = next;
  }
}

export function fetchIssueInventory(
  options: FetchInventoryOptions,
): Promise<InventoryResult> {
  return fetchInventory("issue", options);
}
