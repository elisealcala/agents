/** Durable GitHub sync checkpoints and observations. Pages commit atomically with their cursor. */
import type { SqlDriver } from "./sql-driver.ts";
import type { InventoryItem } from "../integrations/github/issues";

export interface SyncCheckpoint {
  scope: string;
  /** Watermark of the last fully completed scan; only advanced on completion. */
  completedSince: string | null;
  /** Resume cursor of the in-progress scan (last fully committed page). */
  pageCursor: string | null;
  /** Watermark the in-progress scan will publish when it completes. */
  pendingSince: string | null;
  fence: number;
  failures: number;
  retryAt: string | null;
  blockedReason: string | null;
  lastSuccessAt: string | null;
}

type Row = {
  scope: string;
  completed_since: string | null;
  page_cursor: string | null;
  pending_since: string | null;
  fence: number;
  failures: number;
  retry_at: string | null;
  blocked_reason: string | null;
  last_success_at: string | null;
};

export class GitHubSyncStore {
  constructor(private readonly db: SqlDriver) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS github_sync_checkpoints(" +
        "scope TEXT PRIMARY KEY, completed_since TEXT, page_cursor TEXT, pending_since TEXT, " +
        "fence INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, " +
        "retry_at TEXT, blocked_reason TEXT, last_success_at TEXT)",
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS github_sync_observations(" +
        "key TEXT PRIMARY KEY, scope TEXT NOT NULL, payload TEXT NOT NULL, " +
        "updated_at TEXT NOT NULL, observed_at TEXT NOT NULL)",
    );
  }

  getCheckpoint(scope: string): SyncCheckpoint | undefined {
    const row = this.db
      .prepare("SELECT * FROM github_sync_checkpoints WHERE scope = ?")
      .get(scope) as Row | undefined;
    return row && toCheckpoint(row);
  }

  listObservations(scope: string): InventoryItem[] {
    const rows = this.db
      .prepare(
        "SELECT payload FROM github_sync_observations WHERE scope = ? ORDER BY key",
      )
      .all(scope) as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as InventoryItem);
  }

  /** Starts a fenced attempt, superseding any earlier one. Null while backing off. */
  beginAttempt(
    scope: string,
    now: string,
    pendingSince: string,
  ): { fence: number; checkpoint: SyncCheckpoint } | null {
    return this.db.transaction(() => {
      const existing = this.getCheckpoint(scope);
      if (existing?.retryAt && Date.parse(existing.retryAt) > Date.parse(now))
        return null;
      if (!existing) {
        this.db
          .prepare(
            "INSERT INTO github_sync_checkpoints(scope, pending_since, fence) VALUES (?, ?, 1)",
          )
          .run(scope, pendingSince);
      } else {
        this.db
          .prepare(
            "UPDATE github_sync_checkpoints SET fence = fence + 1, " +
              "pending_since = COALESCE(pending_since, ?) WHERE scope = ?",
          )
          .run(pendingSince, scope);
      }
      const checkpoint = this.getCheckpoint(scope);
      if (!checkpoint) throw new Error("Checkpoint missing");
      return { fence: checkpoint.fence, checkpoint };
    });
  }

  /** Commits observations and the page cursor together; false if the attempt was fenced out. */
  commitPage(
    scope: string,
    fence: number,
    items: readonly InventoryItem[],
    nextCursor: string | null,
  ): boolean {
    return this.db.transaction(() => {
      if (!this.fenceHolds(scope, fence)) return false;
      for (const item of items) this.upsert(scope, item);
      this.db
        .prepare(
          "UPDATE github_sync_checkpoints SET page_cursor = ? WHERE scope = ? AND fence = ?",
        )
        .run(nextCursor, scope, fence);
      return true;
    });
  }

  /** Publishes the completed watermark; the only place it advances. */
  complete(scope: string, fence: number, now: string): boolean {
    return this.db.transaction(() => {
      if (!this.fenceHolds(scope, fence)) return false;
      this.db
        .prepare(
          "UPDATE github_sync_checkpoints SET completed_since = pending_since, pending_since = NULL, " +
            "page_cursor = NULL, failures = 0, retry_at = NULL, blocked_reason = NULL, " +
            "last_success_at = ? WHERE scope = ? AND fence = ?",
        )
        .run(now, scope, fence);
      return true;
    });
  }

  /** Records a failure and schedules recovery; observations and cursors are untouched. */
  fail(
    scope: string,
    fence: number,
    reason: string,
    retryAt: string,
    failures: number,
  ): boolean {
    return this.db.transaction(() => {
      if (!this.fenceHolds(scope, fence)) return false;
      this.db
        .prepare(
          "UPDATE github_sync_checkpoints SET failures = ?, retry_at = ?, blocked_reason = ? " +
            "WHERE scope = ? AND fence = ?",
        )
        .run(failures, retryAt, reason, scope, fence);
      return true;
    });
  }

  private fenceHolds(scope: string, fence: number): boolean {
    return this.getCheckpoint(scope)?.fence === fence;
  }

  private upsert(scope: string, item: InventoryItem): void {
    const existing = this.db
      .prepare("SELECT updated_at FROM github_sync_observations WHERE key = ?")
      .get(item.key) as { updated_at: string } | undefined;
    if (!existing) {
      this.db
        .prepare(
          "INSERT INTO github_sync_observations(key, scope, payload, updated_at, observed_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          item.key,
          scope,
          JSON.stringify(item),
          item.updatedAt,
          item.observedAt,
        );
    } else if (Date.parse(existing.updated_at) <= Date.parse(item.updatedAt)) {
      this.db
        .prepare(
          "UPDATE github_sync_observations SET payload = ?, updated_at = ?, observed_at = ? WHERE key = ?",
        )
        .run(JSON.stringify(item), item.updatedAt, item.observedAt, item.key);
    }
  }
}

function toCheckpoint(row: Row): SyncCheckpoint {
  return {
    scope: row.scope,
    completedSince: row.completed_since,
    pageCursor: row.page_cursor,
    pendingSince: row.pending_since,
    fence: row.fence,
    failures: row.failures,
    retryAt: row.retry_at,
    blockedReason: row.blocked_reason,
    lastSuccessAt: row.last_success_at,
  };
}
