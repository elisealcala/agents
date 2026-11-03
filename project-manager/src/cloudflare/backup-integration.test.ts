import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableEvidenceStore } from "../../../ingest-classifier/src/evidence/durable-store.ts";
import { DurableManagerStore } from "../storage/durable-manager-store.ts";
import {
  createDurableSqlDriver,
  type DurableSqlStorage,
} from "../storage/sql-driver.ts";
import {
  captureSnapshot,
  validateSnapshotPair,
  type Snapshot,
} from "../storage/snapshot.ts";
import { BACKUP_INTERVAL_MS, BACKUP_RETRY_MS } from "./backup-scheduler.ts";
import { DELIVERY_INTERVAL_MS } from "./delivery-alarm.ts";
import { DurableEvidenceObject } from "./evidence-object.ts";
import { DurableManagerObject } from "./manager-object.ts";

const token = "fixture-service-token-0123456789-abcdefgh";
const owner = "16949569";
const headers = { authorization: `Bearer ${token}`, "x-manager-actor": owner };
const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
});
function makeStorage() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys=ON");
  const kv = new Map<string, unknown>();
  const events: string[] = [];
  let alarmAt: number | null = null;
  const storage: DurableSqlStorage & {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
  } = {
    sql: {
      exec(query, ...values) {
        if (/^\s*CREATE\b/i.test(query) && !values.length) {
          db.exec(query);
          return { toArray: () => [], rowsWritten: 0 };
        }
        const statement = db.prepare(query);
        if (statement.columns().length) {
          const rows = statement.all(...values);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        const result = statement.run(...values);
        return { toArray: () => [], rowsWritten: Number(result.changes) };
      },
    },
    transactionSync<T>(operation: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async get<T>(key: string) {
      return kv.get(key) as T | undefined;
    },
    async put(key, value) {
      events.push(`kv:${key}`);
      kv.set(key, structuredClone(value));
    },
    async getAlarm() {
      return alarmAt;
    },
    async setAlarm(at) {
      events.push(`alarm:${at}`);
      alarmAt = at;
    },
  };
  return {
    db,
    storage,
    events,
    kv,
    alarm: () => alarmAt,
    consumeAlarm: () => {
      alarmAt = null;
    },
  };
}
function fixture() {
  const managerStorage = makeStorage();
  const evidenceStorage = makeStorage();
  const evidenceObject = new DurableEvidenceObject(
    { storage: evidenceStorage.storage },
    { MANAGER_SERVICE_TOKEN: token, MANAGER_OWNER_ID: owner },
  );
  const evidenceFetch = vi.fn((request: Request) =>
    evidenceObject.fetch(request),
  );
  const EVIDENCE = {
    idFromName: (name: string) => name,
    get: (id: unknown) => {
      expect(id).toBe("primary");
      return { fetch: evidenceFetch };
    },
  };
  const objects = new Map<string, string>();
  const calls: string[] = [];
  let failPut = false;
  let alterRead = false;
  const BACKUPS = {
    async put(key: string, body: string) {
      calls.push("put");
      if (failPut) throw new Error("private bucket error");
      objects.set(key, body);
    },
    async get(key: string) {
      calls.push("get");
      const body = objects.get(key);
      return body === undefined
        ? null
        : {
            async text() {
              return alterRead ? "altered" : body;
            },
          };
    },
  };
  const state = {
    storage: managerStorage.storage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  };
  const env = {
    MANAGER_SERVICE_TOKEN: token,
    MANAGER_OWNER_ID: owner,
    BACKUP_ENABLED: "true",
    BACKUPS,
    EVIDENCE,
  };
  const target = new DurableManagerObject(state, env);
  return {
    managerStorage,
    evidenceStorage,
    evidenceObject,
    evidenceFetch,
    state,
    env,
    target,
    BACKUPS,
    EVIDENCE,
    objects,
    calls,
    setFailPut(value: boolean) {
      failPut = value;
    },
    setAlterRead(value: boolean) {
      alterRead = value;
    },
  };
}
const now = Date.parse("2026-11-02T12:34:00.000Z");
const listRequest = () =>
  new Request("https://manager.internal/trpc/projects.list", { headers });
const statusRequest = () =>
  new Request("https://manager.internal/backup/status", { headers });
const evidenceRequest = (requestHeaders: HeadersInit = headers) =>
  new Request("https://evidence.internal/backup/snapshot", {
    method: "POST",
    headers: requestHeaders,
  });

describe("durable object backup integration", () => {
  it("arms the first backup on a manager request and reports schedule without rescheduling an existing alarm", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    expect((await f.target.fetch(listRequest())).status).toBe(200);
    expect(f.managerStorage.alarm()).toBe(now + 1000);
    await f.target.fetch(listRequest());
    expect(
      f.managerStorage.events.filter((event) => event.startsWith("alarm:")),
    ).toEqual([`alarm:${now + 1000}`]);
    const response = await f.target.fetch(statusRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      configured: true,
      hasBackup: false,
      latest: null,
      next: now + 1000,
    });
  });

  it("backs up linked manager and evidence, verifying readback before recording success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    const manager = new DurableManagerStore(f.managerStorage.storage);
    const project = manager.create("Fixture project");
    const evidence = new DurableEvidenceStore(f.evidenceStorage.storage);
    const source = evidence.register({
      projectId: project.id,
      sourceId: "source",
      sourceVersion: "1",
      idempotencyKey: "retry",
      markdown: "Private source 😀",
      sourceDate: "2026-11-02",
    });
    project.notes.push({
      id: "note",
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
      markdown: source.markdown,
      sourceDate: source.sourceDate,
      checksum: source.checksum,
      documentRef: source.documentRef,
      status: "review",
      indexStatus: "ready",
      runId: "run",
      error: null,
    });
    manager.save(project);
    await f.target.fetch(listRequest());
    f.managerStorage.consumeAlarm();
    vi.setSystemTime(now + 1000);
    await f.target.alarm();
    expect(f.managerStorage.kv.get("stage2-backup-due")).toBe(
      now + 1000 + BACKUP_INTERVAL_MS,
    );
    expect(f.calls).toEqual(["put", "get"]);
    expect(f.objects.size).toBe(1);
    const [key, contents] = [...f.objects.entries()][0];
    expect(key).toMatch(/^manager-backups\/2026-11-02\/\d+-[a-f0-9-]+\.json$/);
    const pair = JSON.parse(contents) as {
      manager: Snapshot;
      evidence: Snapshot;
    };
    expect(() =>
      validateSnapshotPair(pair.manager, pair.evidence),
    ).not.toThrow();
    expect(pair.evidence.tables[0].rows[0]).toContain("Private source 😀");
    expect(f.evidenceFetch).toHaveBeenCalledTimes(1);
    expect(f.evidenceFetch.mock.calls[0][0].url).toBe(
      "https://evidence.internal/backup/snapshot",
    );
    const status = await (await f.target.fetch(statusRequest())).json();
    expect(status).toEqual({
      configured: true,
      hasBackup: true,
      latest: { state: "ok", at: "2026-11-02T12:34:01.000Z", key },
      next: now + 1000 + BACKUP_INTERVAL_MS,
    });
    const scheduleEvents = f.managerStorage.events.filter((event) =>
      event.startsWith("alarm:"),
    );
    expect(scheduleEvents[0]).toBe(`alarm:${now + 1000}`);
    expect(f.managerStorage.alarm()).toBe(now + 1000 + DELIVERY_INTERVAL_MS);
  });

  it.each(["put", "readback"] as const)(
    "records generic failure with retry armed when %s fails",
    async (failure) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const f = fixture();
      await f.target.fetch(listRequest());
      f.managerStorage.consumeAlarm();
      vi.setSystemTime(now + 1000);
      f.setFailPut(failure === "put");
      f.setAlterRead(failure === "readback");
      await f.target.alarm();
      expect(f.managerStorage.alarm()).toBe(now + 1000 + DELIVERY_INTERVAL_MS);
      const status = await (await f.target.fetch(statusRequest())).json();
      expect(status).toEqual({
        configured: true,
        hasBackup: false,
        latest: { state: "error", at: "2026-11-02T12:34:01.000Z" },
        next: now + 1000 + BACKUP_RETRY_MS,
      });
      expect(JSON.stringify(status)).not.toContain("private bucket error");
    },
  );

  it("does not back up a partially migrated manager", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    await f.managerStorage.storage.put("stage2-migration", {
      version: 1,
      manager: "a".repeat(64),
      evidence: "b".repeat(64),
      phase: "evidence",
    });
    expect((await f.target.fetch(listRequest())).status).toBe(503);
    await f.target.alarm();
    expect(f.objects.size).toBe(0);
    expect(f.evidenceFetch).not.toHaveBeenCalled();
    expect(f.managerStorage.alarm()).toBe(now + DELIVERY_INTERVAL_MS);
    expect(f.managerStorage.kv.get("stage2-backup-due")).toBe(
      now + BACKUP_RETRY_MS,
    );
  });

  it("keeps retrying and reports an error if backups are enabled but storage is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    const target = new DurableManagerObject(f.state, {
      ...f.env,
      BACKUPS: undefined,
    });
    expect((await target.fetch(listRequest())).status).toBe(200);
    expect(f.managerStorage.alarm()).toBe(now + 1000);
    f.managerStorage.consumeAlarm();
    vi.setSystemTime(now + 1000);
    await target.alarm();
    expect(f.managerStorage.alarm()).toBe(now + 1000 + DELIVERY_INTERVAL_MS);
    expect(f.managerStorage.kv.get("stage2-backup-due")).toBe(
      now + 1000 + BACKUP_RETRY_MS,
    );
    expect(f.managerStorage.kv.get("stage2-backup-status")).toEqual({
      state: "error",
      at: "2026-11-02T12:34:01.000Z",
    });
    expect(f.evidenceFetch).not.toHaveBeenCalled();
  });

  it("does not schedule or write backups when disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    const target = new DurableManagerObject(f.state, {
      ...f.env,
      BACKUP_ENABLED: "false",
    });
    expect((await target.fetch(listRequest())).status).toBe(200);
    await target.alarm();
    expect(f.managerStorage.alarm()).toBe(now + DELIVERY_INTERVAL_MS);
    expect(f.objects.size).toBe(0);
    expect(f.evidenceFetch).not.toHaveBeenCalled();
  });

  it("initializes and snapshots an untouched evidence object, while rejecting unsigned access", async () => {
    const f = fixture();
    for (const invalid of [
      {},
      { ...headers, "x-manager-actor": "other" },
      { ...headers, origin: "https://other.example" },
    ]) {
      expect(
        (await f.evidenceObject.fetch(evidenceRequest(invalid))).status,
      ).toBe(401);
    }
    expect(
      (
        await f.evidenceObject.fetch(
          new Request("https://evidence.internal/backup/snapshot", { headers }),
        )
      ).status,
    ).toBe(404);
    const response = await f.evidenceObject.fetch(evidenceRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const snapshot = (await response.json()) as Snapshot;
    expect(snapshot.kind).toBe("evidence");
    expect(snapshot.tables.every((table) => table.rows.length === 0)).toBe(
      true,
    );
    expect(
      captureSnapshot(
        createDurableSqlDriver(f.evidenceStorage.storage),
        "evidence",
      ),
    ).toEqual(snapshot);
  });

  it("does not initialize over an evidence database with unrelated or incompatible tables", async () => {
    const f = fixture();
    f.evidenceStorage.db.exec("CREATE TABLE unrelated(id TEXT PRIMARY KEY)");
    expect((await f.evidenceObject.fetch(evidenceRequest())).status).toBe(503);
    const rows = f.evidenceStorage.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    expect(rows).toEqual([{ name: "unrelated" }]);
  });
});
