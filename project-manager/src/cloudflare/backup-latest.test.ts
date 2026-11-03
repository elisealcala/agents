import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableEvidenceStore } from "../../../ingest-classifier/src/evidence/durable-store.ts";
import { DurableManagerStore } from "../storage/durable-manager-store.ts";
import type { DurableSqlStorage } from "../storage/sql-driver.ts";
import { validateSnapshotPair, type Snapshot } from "../storage/snapshot.ts";
import { DurableEvidenceObject } from "./evidence-object.ts";
import { DurableManagerObject } from "./manager-object.ts";

const token = "fixture-service-token-0123456789-abcdefgh";
const owner = "16949569";
const headers = { authorization: `Bearer ${token}`, "x-manager-actor": owner };
const now = Date.parse("2026-11-02T12:34:00.000Z");
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
  let alarm: number | null = null;
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
    transactionSync<T>(fn: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
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
      kv.set(key, structuredClone(value));
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(value) {
      alarm = value;
    },
  };
  return { db, storage, kv };
}
function fixture() {
  const managerStorage = makeStorage();
  const evidenceStorage = makeStorage();
  const manager = new DurableManagerStore(managerStorage.storage);
  const project = manager.create("Private project");
  const evidence = new DurableEvidenceStore(evidenceStorage.storage);
  const source = evidence.register({
    projectId: project.id,
    sourceId: "note",
    sourceVersion: "1",
    idempotencyKey: "retry",
    markdown: "Private evidence 😀",
    sourceDate: "2026-11-02",
  });
  project.notes.push({
    id: "note",
    sourceId: source.sourceId,
    sourceVersion: source.sourceVersion,
    checksum: source.checksum,
    markdown: source.markdown,
    sourceDate: source.sourceDate,
    documentRef: source.documentRef,
    status: "review",
    indexStatus: "ready",
    runId: "run",
    error: null,
  });
  manager.save(project);
  const evidenceObject = new DurableEvidenceObject(
    { storage: evidenceStorage.storage },
    { MANAGER_SERVICE_TOKEN: token, MANAGER_OWNER_ID: owner },
  );
  const EVIDENCE = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: (request: Request) => evidenceObject.fetch(request) }),
  };
  const objects = new Map<string, string>();
  const get = vi.fn(async (key: string) => {
    const body = objects.get(key);
    return body === undefined ? null : { text: async () => body };
  });
  let failPut = false;
  const BACKUPS = {
    put: async (key: string, body: string) => {
      if (failPut) throw new Error("private failure");
      objects.set(key, body);
    },
    get,
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
    target,
    state,
    env,
    objects,
    get,
    failNextPut() {
      failPut = true;
    },
  };
}
const download = (requestHeaders: HeadersInit = headers) =>
  new Request("https://manager.internal/backup/latest", {
    headers: requestHeaders,
  });
const status = () =>
  new Request("https://manager.internal/backup/status", { headers });

describe("private latest verified backup", () => {
  it("serves exact verified backup bytes as a private attachment and preserves the last good backup after a later failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    await f.target.alarm();
    const key = f.managerStorage.kv.get("stage2-last-good-backup");
    expect(typeof key).toBe("string");
    const body = f.objects.get(key as string);
    expect(body).toBeDefined();
    const response = await f.target.fetch(download());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=manager-backup.json",
    );
    expect(await response.text()).toBe(body);
    const pair = JSON.parse(body as string) as {
      manager: Snapshot;
      evidence: Snapshot;
    };
    expect(() =>
      validateSnapshotPair(pair.manager, pair.evidence),
    ).not.toThrow();
    f.failNextPut();
    vi.setSystemTime(now + 60_000);
    await f.target.alarm();
    expect(f.managerStorage.kv.get("stage2-last-good-backup")).toBe(key);
    expect(await (await f.target.fetch(status())).json()).toMatchObject({
      hasBackup: true,
      latest: { state: "error" },
    });
    const latest = await f.target.fetch(download());
    expect(latest.status).toBe(200);
    expect(await latest.text()).toBe(body);
  });

  it("requires the service credential and owner; no request reaches the bucket for unauthorized calls", async () => {
    const f = fixture();
    const invalidHeaders: HeadersInit[] = [
      {},
      { authorization: `Bearer ${token}` },
      { ...headers, "x-manager-actor": "other" },
      { ...headers, origin: "https://other.example" },
    ];
    for (const invalid of invalidHeaders) {
      const response = await f.target.fetch(download(invalid));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(f.get).not.toHaveBeenCalled();
  });

  it("fails closed for absent or invalid pointers without contacting the bucket", async () => {
    const f = fixture();
    for (const invalid of [
      undefined,
      null,
      {},
      "../private",
      "manager-backups/2026-11-02/1-../bad.json",
      "manager-backups/2026-11-02/1-a.json?token=secret",
    ]) {
      if (invalid === undefined)
        f.managerStorage.kv.delete("stage2-last-good-backup");
      else f.managerStorage.kv.set("stage2-last-good-backup", invalid);
      expect((await f.target.fetch(download())).status).toBe(503);
    }
    expect(f.get).not.toHaveBeenCalled();
  });

  it("rejects missing, corrupted, oversized or malformed stored backups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    await f.target.alarm();
    const key = f.managerStorage.kv.get("stage2-last-good-backup") as string;
    const original = f.objects.get(key) as string;
    f.objects.delete(key);
    expect((await f.target.fetch(download())).status).toBe(503);
    const altered = JSON.parse(original);
    altered.evidence.tables[0].rows[0][5] = "changed source";
    for (const data of [
      "not json",
      "{}",
      JSON.stringify(altered),
      JSON.stringify({ manager: {}, evidence: {} }),
      "a".repeat(8 * 1024 * 1024 + 1),
    ]) {
      f.objects.set(key, data);
      const response = await f.target.fetch(download());
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).toBe("");
    }
  });

  it("rejects a valid pair if its persisted work is no longer quiescent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = fixture();
    f.managerStorage.db
      .prepare("INSERT INTO runs VALUES (?, ?)")
      .run(
        "running",
        JSON.stringify({ id: "running", status: "running", spans: [] }),
      );
    // Directly invoke the capture before manager startup recovery rewrites the source.
    const { captureSnapshot } = await import("../storage/snapshot.ts");
    const { createDurableSqlDriver } = await import("../storage/sql-driver.ts");
    const pair = {
      manager: captureSnapshot(
        createDurableSqlDriver(f.managerStorage.storage),
        "manager",
      ),
      evidence: captureSnapshot(
        createDurableSqlDriver(f.evidenceStorage.storage),
        "evidence",
      ),
    };
    const key = `manager-backups/2026-11-02/${now}-fixture.json`;
    f.managerStorage.kv.set("stage2-last-good-backup", key);
    f.objects.set(key, JSON.stringify(pair));
    expect((await f.target.fetch(download())).status).toBe(503);
  });
});
