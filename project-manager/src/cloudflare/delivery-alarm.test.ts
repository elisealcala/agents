import { describe, expect, it } from "vitest";
import { nextWakeup } from "./delivery-alarm.ts";

describe("delivery and backup alarm deadlines", () => {
  it("selects the earliest deadline, or delivery alone when backups are disabled", () => {
    expect(nextWakeup(100, null)).toBe(100);
    expect(nextWakeup(100, 200)).toBe(100);
    expect(nextWakeup(200, 100)).toBe(100);
    expect(nextWakeup(100, 100)).toBe(100);
    expect(nextWakeup(0, 0)).toBe(0);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid deadline %s in either position",
    (invalid) => {
      expect(() => nextWakeup(invalid, null)).toThrow("Invalid wakeup time");
      expect(() => nextWakeup(0, invalid)).toThrow("Invalid wakeup time");
    },
  );
});

import { DatabaseSync } from "node:sqlite";
import { afterEach, vi } from "vitest";
import type { Adapters } from "../delivery/scheduler.ts";
import { DurableManagerStore } from "../storage/durable-manager-store.ts";
import type { DurableSqlStorage } from "../storage/sql-driver.ts";
import { BACKUP_RETRY_MS } from "./backup-scheduler.ts";
import { DELIVERY_BATCH_SIZE, DELIVERY_INTERVAL_MS } from "./delivery-alarm.ts";
import { DurableManagerObject } from "./manager-object.ts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.close();
});
const now = Date.parse("2026-11-02T12:00:00.000Z");
function fixture(
  options: { backup?: boolean; importMode?: string; adapters?: Adapters } = {},
) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys=ON");
  const values = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage: DurableSqlStorage & {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
  } = {
    sql: {
      exec(query, ...params) {
        if (/^\s*CREATE\b/i.test(query) && !params.length) {
          db.exec(query);
          return { toArray: () => [], rowsWritten: 0 };
        }
        const statement = db.prepare(query);
        if (statement.columns().length)
          return { toArray: () => statement.all(...params), rowsWritten: 0 };
        return {
          toArray: () => [],
          rowsWritten: Number(statement.run(...params).changes),
        };
      },
    },
    transactionSync<T>(operation: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = operation();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put(key, value) {
      values.set(key, structuredClone(value));
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(at) {
      alarm = at;
    },
  };
  const delivery = new DurableManagerStore(storage).delivery;
  delivery.registerRepository({
    provider: "github",
    repositoryId: "synthetic",
    owner: "example",
    name: "repo",
  });
  class FixtureManager extends DurableManagerObject {
    protected override deliveryAdapters(): Adapters {
      return options.adapters ?? {};
    }
  }
  const target = new FixtureManager(
    { storage, blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn() },
    {
      MANAGER_SERVICE_TOKEN: "fixture-service-token-0123456789-abcdefgh",
      MANAGER_OWNER_ID: "123456",
      BACKUP_ENABLED: options.backup ? "true" : "false",
      MANAGER_IMPORT_MODE: options.importMode,
    },
  );
  return {
    delivery,
    target,
    values,
    storage,
    get alarm() {
      return alarm;
    },
  };
}

describe("durable delivery alarm integration", () => {
  it("recovers the oldest leases across jobs and outbox with a shared batch limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    f.delivery.enqueueJob("old-job", "synthetic", "unknown");
    f.delivery.enqueueJob("new-job", "synthetic", "unknown");
    f.delivery.claimJob(
      "old-job",
      "attempt-old",
      new Date(now - 10_000).toISOString(),
      new Date(now - 9_000).toISOString(),
    );
    f.delivery.claimJob(
      "new-job",
      "attempt-new",
      new Date(now - 10_000).toISOString(),
      new Date(now - 1_000).toISOString(),
    );
    for (let i = 0; i < DELIVERY_BATCH_SIZE; i++) {
      const id = `repo-${i}`;
      f.delivery.registerRepository({
        provider: "github",
        repositoryId: id,
        owner: "example",
        name: id,
      });
      f.delivery.transition(id, 0, "in_progress", {
        id: `intent-${i}`,
        operationKey: `operation-${i}`,
        kind: "unknown",
      });
      f.delivery.claimOutbox(
        `intent-${i}`,
        `attempt-${i}`,
        new Date(now - 10_000).toISOString(),
        new Date(now - 5_000).toISOString(),
      );
    }
    await f.target.alarm();
    expect(f.delivery.listJobs("synthetic").map((job) => job.status)).toEqual([
      "reconciling",
      "running",
    ]);
    const statuses = Array.from(
      { length: DELIVERY_BATCH_SIZE },
      (_, i) => f.delivery.listOutbox(`repo-${i}`)[0].status,
    );
    expect(statuses.filter((status) => status === "unknown")).toHaveLength(
      DELIVERY_BATCH_SIZE - 1,
    );
    expect(statuses.filter((status) => status === "dispatching")).toHaveLength(
      1,
    );
    vi.setSystemTime(now + DELIVERY_INTERVAL_MS);
    await f.target.alarm();
    expect(
      f.delivery
        .listJobs("synthetic")
        .every((job) => job.status === "reconciling"),
    ).toBe(true);
    for (let i = 0; i < DELIVERY_BATCH_SIZE; i++)
      expect(f.delivery.listOutbox(`repo-${i}`)[0].status).toBe("unknown");
  });

  it("prearms a retry before attempting to read the backup deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture({ backup: true });
    f.storage.get = async () => {
      throw new Error("storage unavailable");
    };
    await expect(f.target.alarm()).rejects.toThrow("storage unavailable");
    expect(f.alarm).toBe(now + DELIVERY_INTERVAL_MS);
  });
  it("dispatches registered work behind a large queue of unknown kinds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const scan = vi.fn(async () => {});
    const f = fixture({ adapters: { jobs: { scan } } });
    for (let i = 0; i < DELIVERY_BATCH_SIZE * 4; i++)
      f.delivery.enqueueJob(`unknown-${i}`, "synthetic", "unregistered");
    f.delivery.enqueueJob("eligible", "synthetic", "scan");
    await f.target.alarm();
    expect(scan).toHaveBeenCalledOnce();
    expect(
      f.delivery.listJobs("synthetic").find((job) => job.id === "eligible")
        ?.status,
    ).toBe("completed");
    expect(
      f.delivery
        .listJobs("synthetic")
        .filter(
          (job) => job.kind === "unregistered" && job.status === "queued",
        ),
    ).toHaveLength(DELIVERY_BATCH_SIZE * 4);
  });

  it("recovers at most one bounded batch of expired jobs per wakeup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    for (let i = 0; i < DELIVERY_BATCH_SIZE + 2; i++) {
      f.delivery.enqueueJob(`job-${i}`, "synthetic", "unregistered");
      f.delivery.claimJob(
        `job-${i}`,
        `attempt-${i}`,
        new Date(now - 2000).toISOString(),
        new Date(now - 1000).toISOString(),
      );
    }
    await f.target.alarm();
    expect(
      f.delivery
        .listJobs("synthetic")
        .filter((job) => job.status === "reconciling"),
    ).toHaveLength(DELIVERY_BATCH_SIZE);
    expect(
      f.delivery
        .listJobs("synthetic")
        .filter((job) => job.status === "running"),
    ).toHaveLength(2);
    vi.setSystemTime(now + DELIVERY_INTERVAL_MS);
    await f.target.alarm();
    expect(
      f.delivery
        .listJobs("synthetic")
        .filter((job) => job.status === "reconciling"),
    ).toHaveLength(DELIVERY_BATCH_SIZE + 2);
  });

  it("gives queued jobs and outbox intents a chance when both have backlog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const scan = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    const f = fixture({ adapters: { jobs: { scan }, outbox: { sync } } });
    for (let i = 0; i < DELIVERY_BATCH_SIZE + 1; i++)
      f.delivery.enqueueJob(`job-${i}`, "synthetic", "scan");
    f.delivery.transition("synthetic", 0, "in_progress", {
      id: "intent",
      operationKey: "fixture",
      kind: "sync",
    });
    await f.target.alarm();
    expect(scan.mock.calls.length).toBeGreaterThan(0);
    expect(sync).toHaveBeenCalledOnce();
    expect(scan.mock.calls.length + sync.mock.calls.length).toBeLessThanOrEqual(
      DELIVERY_BATCH_SIZE,
    );
    expect(f.delivery.listOutbox("synthetic")[0].status).toBe("confirmed");
  });

  it("bounds a tick, retains unknown jobs, and runs remaining work at the next wakeup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const scan = vi.fn(async () => {});
    const f = fixture({ adapters: { jobs: { scan } } });
    f.delivery.enqueueJob("unknown", "synthetic", "unregistered");
    for (let i = 0; i < DELIVERY_BATCH_SIZE + 1; i++)
      f.delivery.enqueueJob(`job-${i}`, "synthetic", "scan");
    await f.target.alarm();
    expect(scan).toHaveBeenCalledTimes(DELIVERY_BATCH_SIZE);
    expect(
      f.delivery.listJobs("synthetic").find((job) => job.id === "unknown")
        ?.status,
    ).toBe("queued");
    expect(
      f.delivery.listJobs("synthetic").filter((job) => job.status === "queued"),
    ).toHaveLength(2);
    expect(f.alarm).toBe(now + DELIVERY_INTERVAL_MS);
    vi.setSystemTime(now + DELIVERY_INTERVAL_MS);
    await f.target.alarm();
    expect(scan).toHaveBeenCalledTimes(DELIVERY_BATCH_SIZE + 1);
    expect(
      f.delivery.listJobs("synthetic").find((job) => job.id === "unknown")
        ?.status,
    ).toBe("queued");
  });
  it("preserves a failed backup retry deadline across intervening delivery wakeups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture({ backup: true });
    await f.target.alarm();
    expect(f.values.get("stage2-backup-due")).toBe(now + BACKUP_RETRY_MS);
    expect(f.alarm).toBe(now + DELIVERY_INTERVAL_MS);
    vi.setSystemTime(now + DELIVERY_INTERVAL_MS);
    await f.target.alarm();
    expect(f.values.get("stage2-backup-due")).toBe(now + BACKUP_RETRY_MS);
    expect(f.alarm).toBe(now + 2 * DELIVERY_INTERVAL_MS);
    vi.setSystemTime(now + BACKUP_RETRY_MS - 1000);
    await f.target.alarm();
    expect(f.alarm).toBe(now + BACKUP_RETRY_MS);
  });
  it("does not dispatch a job while paired migration is incomplete", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const scan = vi.fn(async () => {});
    const f = fixture({ importMode: "required", adapters: { jobs: { scan } } });
    f.delivery.enqueueJob("job", "synthetic", "scan");
    await f.target.alarm();
    expect(scan).not.toHaveBeenCalled();
    expect(f.delivery.listJobs("synthetic")[0].status).toBe("queued");
    expect(f.alarm).toBe(now + DELIVERY_INTERVAL_MS);
  });
  it("recovers an expired job lease for reconciliation without dispatching it again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const scan = vi.fn(async () => {});
    const f = fixture({ adapters: { jobs: { scan } } });
    f.delivery.enqueueJob("job", "synthetic", "scan");
    f.delivery.claimJob(
      "job",
      "old-attempt",
      new Date(now - 2000).toISOString(),
      new Date(now - 1000).toISOString(),
    );
    await f.target.alarm();
    expect(scan).not.toHaveBeenCalled();
    expect(f.delivery.listJobs("synthetic")[0].status).toBe("reconciling");
    expect(() =>
      f.delivery.finishJob(
        "job",
        "old-attempt",
        new Date(now).toISOString(),
        "completed",
      ),
    ).toThrow("Stale or expired attempt");
  });
});
