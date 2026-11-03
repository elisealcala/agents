import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceCoreStore } from "../../../ingest-classifier/src/evidence/core-store.ts";
import { nodeEvidenceDriver } from "../../../ingest-classifier/src/evidence/sql-driver.ts";
import { ManagerStore } from "../storage/manager-store.ts";
import { captureSnapshot } from "../storage/snapshot.ts";
import { createNodeSqlDriver } from "../storage/sql-driver.ts";
import {
  BACKUP_INTERVAL_MS,
  BACKUP_RETRY_MS,
  type BackupDependencies,
  type BackupStatus,
  runScheduledBackup,
} from "./backup-scheduler.ts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
function fixture(options: { active?: boolean; content?: string } = {}) {
  const manager = new DatabaseSync(":memory:");
  const evidence = new DatabaseSync(":memory:");
  databases.push(manager, evidence);
  const driver = createNodeSqlDriver(manager);
  new ManagerStore(driver);
  const store = new EvidenceCoreStore(nodeEvidenceDriver(evidence));
  const source = store.register({
    projectId: "project-one",
    sourceId: "note-one",
    sourceVersion: "1",
    idempotencyKey: "key-one",
    markdown: options.content ?? "Private evidence 😀",
  });
  manager.prepare("INSERT INTO projects VALUES (?, ?)").run(
    source.projectId,
    JSON.stringify({
      id: source.projectId,
      notes: [{ ...source, status: options.active ? "storing" : "review" }],
    }),
  );
  const pair = {
    manager: captureSnapshot(driver, "manager"),
    evidence: captureSnapshot(createNodeSqlDriver(evidence), "evidence"),
  };
  const start = Date.parse("2026-11-02T12:34:00.000Z");
  const events: string[] = [];
  const objects = new Map<string, string>();
  const statuses: BackupStatus[] = [];
  let scheduled: number | null = null;
  let now = start;
  const deps: BackupDependencies = {
    now: () => now,
    async schedule(at) {
      events.push(`schedule:${at}`);
      scheduled = at;
    },
    async capture() {
      events.push("capture");
      return pair;
    },
    async put(key, body) {
      events.push("put");
      objects.set(key, body);
    },
    async get(key) {
      events.push("get");
      return objects.get(key) ?? null;
    },
    async record(status) {
      events.push(`record:${status.state}`);
      statuses.push(status);
    },
    id: () => "fixture-123",
  };
  return {
    start,
    pair,
    deps,
    events,
    objects,
    statuses,
    get scheduled() {
      return scheduled;
    },
    setNow(value: number) {
      now = value;
    },
  };
}

describe("durable verified backup scheduling", () => {
  it("arms retry before capture, verifies exact stored bytes, records success and schedules next day", async () => {
    const f = fixture();
    const capture = f.deps.capture;
    f.deps.capture = async () => {
      const pair = await capture();
      f.setNow(f.start + 5000);
      return pair;
    };
    await runScheduledBackup(f.deps);
    const key = `manager-backups/2026-11-02/${f.start}-fixture-123.json`;
    expect(f.events).toEqual([
      `schedule:${f.start + BACKUP_RETRY_MS}`,
      "capture",
      "put",
      "get",
      "record:ok",
      `schedule:${f.start + 5000 + BACKUP_INTERVAL_MS}`,
    ]);
    expect(f.objects.get(key)).toBe(JSON.stringify(f.pair));
    expect(f.statuses).toEqual([
      { state: "ok", at: "2026-11-02T12:34:00.000Z", key },
    ]);
    expect(f.scheduled).toBe(f.start + 5000 + BACKUP_INTERVAL_MS);
  });

  it("does not capture or claim a backup if the retry alarm cannot be armed", async () => {
    const f = fixture();
    f.deps.schedule = async () => {
      f.events.push("schedule:failure");
      throw new Error("alarm failed");
    };
    await expect(runScheduledBackup(f.deps)).rejects.toThrow();
    expect(f.events).toEqual(["schedule:failure"]);
    expect(f.statuses).toEqual([]);
    expect(f.objects.size).toBe(0);
  });

  it.each(["capture", "put", "get"] as const)(
    "reports a generic error and leaves the retry armed if %s fails",
    async (failure) => {
      const f = fixture();
      const secret = "private source and access details";
      if (failure === "capture")
        f.deps.capture = async () => {
          f.events.push("capture");
          throw new Error(secret);
        };
      if (failure === "put")
        f.deps.put = async () => {
          f.events.push("put");
          throw new Error(secret);
        };
      if (failure === "get")
        f.deps.get = async () => {
          f.events.push("get");
          throw new Error(secret);
        };
      await expect(runScheduledBackup(f.deps)).rejects.toThrow(
        /^Scheduled backup failed$/,
      );
      expect(f.scheduled).toBe(f.start + BACKUP_RETRY_MS);
      expect(f.statuses).toEqual([
        { state: "error", at: "2026-11-02T12:34:00.000Z" },
      ]);
      expect(JSON.stringify(f.statuses)).not.toContain(secret);
      expect(f.events).not.toContain("record:ok");
    },
  );

  it.each(["missing", "changed"] as const)(
    "does not record success when object readback is %s",
    async (failure) => {
      const f = fixture();
      f.deps.get = async () => {
        f.events.push("get");
        return failure === "missing" ? null : "altered";
      };
      await expect(runScheduledBackup(f.deps)).rejects.toThrow(
        /^Scheduled backup failed$/,
      );
      expect(f.scheduled).toBe(f.start + BACKUP_RETRY_MS);
      expect(f.statuses).toEqual([
        { state: "error", at: "2026-11-02T12:34:00.000Z" },
      ]);
      expect(f.events).not.toContain("record:ok");
    },
  );

  it("rejects invalid and nonquiescent snapshots before storing any data", async () => {
    const active = fixture({ active: true });
    await expect(runScheduledBackup(active.deps)).rejects.toThrow(
      /^Scheduled backup failed$/,
    );
    expect(active.objects.size).toBe(0);
    expect(active.scheduled).toBe(active.start + BACKUP_RETRY_MS);
    expect(active.statuses).toEqual([
      { state: "error", at: "2026-11-02T12:34:00.000Z" },
    ]);
    const corrupt = fixture();
    corrupt.pair.evidence.tables[0].rows[0][5] = "changed";
    await expect(runScheduledBackup(corrupt.deps)).rejects.toThrow(
      /^Scheduled backup failed$/,
    );
    expect(corrupt.objects.size).toBe(0);
    expect(corrupt.events).not.toContain("put");
  });

  it("rejects oversized backups and unsafe object IDs without writing", async () => {
    const large = fixture({ content: "a".repeat(8 * 1024 * 1024) });
    await expect(runScheduledBackup(large.deps)).rejects.toThrow(
      /^Scheduled backup failed$/,
    );
    expect(large.objects.size).toBe(0);
    const badId = fixture();
    badId.deps.id = () => "../other/key";
    await expect(runScheduledBackup(badId.deps)).rejects.toThrow(
      /^Scheduled backup failed$/,
    );
    expect(badId.objects.size).toBe(0);
    expect(badId.scheduled).toBe(badId.start + BACKUP_RETRY_MS);
  });

  it("preserves the armed retry when success recording or the next schedule fails", async () => {
    for (const failure of ["record", "schedule"] as const) {
      const f = fixture();
      const record = f.deps.record;
      const schedule = f.deps.schedule;
      f.deps.record = async (status) => {
        if (failure === "record" && status.state === "ok")
          throw new Error("secret");
        await record(status);
      };
      f.deps.schedule = async (at) => {
        if (failure === "schedule" && at !== f.start + BACKUP_RETRY_MS)
          throw new Error("secret");
        await schedule(at);
      };
      await expect(runScheduledBackup(f.deps)).rejects.toThrow(
        /^Scheduled backup failed$/,
      );
      expect(f.scheduled).toBe(f.start + BACKUP_RETRY_MS);
      expect(f.statuses.at(-1)).toEqual({
        state: "error",
        at: "2026-11-02T12:34:00.000Z",
      });
    }
  });
});
