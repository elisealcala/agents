import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableEvidenceStore } from "../../../ingest-classifier/src/evidence/durable-store.ts";
import { DurableManagerStore } from "../storage/durable-manager-store.ts";
import { captureSnapshot } from "../storage/snapshot.ts";
import {
  createDurableSqlDriver,
  type DurableSqlStorage,
} from "../storage/sql-driver.ts";
import { DurableEvidenceObject } from "./evidence-object.ts";
import { DurableManagerObject } from "./manager-object.ts";

const serviceToken = "fixture-service-token-0123456789-abcdefgh";
const migrationToken = "fixture-migration-token-0123456789-abcdef";
const owner = "16949569";
const baseEnv = {
  MANAGER_SERVICE_TOKEN: serviceToken,
  MANAGER_OWNER_ID: owner,
  MANAGER_MIGRATION_TOKEN: migrationToken,
};
const headers = {
  authorization: `Bearer ${serviceToken}`,
  "x-manager-actor": owner,
};
const migrationHeaders = {
  ...headers,
  "x-migration-token": migrationToken,
  "content-type": "application/json",
};
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function makeStorage() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  const kv = new Map<string, unknown>();
  const storage: DurableSqlStorage & {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
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
      kv.set(key, structuredClone(value));
    },
  };
  return { db, storage };
}

function fixture() {
  const originalManager = makeStorage();
  const originalEvidence = makeStorage();
  const manager = new DurableManagerStore(originalManager.storage);
  const project = manager.create("Imported project");
  const evidence = new DurableEvidenceStore(originalEvidence.storage);
  const record = evidence.register({
    projectId: project.id,
    sourceId: "source",
    sourceVersion: "v1",
    idempotencyKey: "retry",
    markdown: "Original private 😀 evidence",
    sourceDate: "2026-11-02",
  });
  evidence.ensureChunks(record);
  project.notes.push({
    id: "note",
    sourceId: record.sourceId,
    sourceVersion: record.sourceVersion,
    markdown: record.markdown,
    sourceDate: record.sourceDate,
    checksum: record.checksum,
    documentRef: record.documentRef,
    status: "review",
    indexStatus: "ready",
    runId: "run",
    error: null,
  });
  manager.save(project);
  const pair = {
    manager: captureSnapshot(
      createDurableSqlDriver(originalManager.storage),
      "manager",
    ),
    evidence: captureSnapshot(
      createDurableSqlDriver(originalEvidence.storage),
      "evidence",
    ),
  };
  const destinationManager = makeStorage();
  const destinationEvidence = makeStorage();
  let evidenceObject = new DurableEvidenceObject(
    { storage: destinationEvidence.storage },
    baseEnv,
  );
  let failAfterRestore = false;
  const evidenceFetch = vi.fn(async (request: Request) => {
    const response = await evidenceObject.fetch(request);
    if (
      failAfterRestore &&
      new URL(request.url).pathname === "/migration/restore" &&
      response.ok
    ) {
      failAfterRestore = false;
      throw new Error("lost acknowledgement");
    }
    return response;
  });
  const binding = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: evidenceFetch }),
  };
  const managerState = {
    storage: destinationManager.storage,
    blockConcurrencyWhile: async <T>(operation: () => Promise<T>) =>
      operation(),
  };
  const env = {
    ...baseEnv,
    MANAGER_IMPORT_MODE: "required",
    EVIDENCE: binding,
  };
  let target = new DurableManagerObject(managerState, env);
  return {
    pair,
    project,
    record,
    destinationManager,
    destinationEvidence,
    env,
    evidenceFetch,
    target: () => target,
    restart: () => {
      evidenceObject = new DurableEvidenceObject(
        { storage: destinationEvidence.storage },
        baseEnv,
      );
      target = new DurableManagerObject(managerState, env);
    },
    loseRestoreAcknowledgement: () => {
      failAfterRestore = true;
    },
  };
}
function importRequest(
  pair: unknown,
  requestHeaders: HeadersInit = migrationHeaders,
) {
  return new Request("https://manager.internal/migration/import", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(pair),
  });
}
function readEvidence(projectId: string, documentRef: string) {
  const input = encodeURIComponent(JSON.stringify({ projectId, documentRef }));
  return new Request(
    `https://manager.internal/trpc/evidence.read?input=${input}`,
    { headers },
  );
}
function listProjects() {
  return new Request("https://manager.internal/trpc/projects.list", {
    headers,
  });
}

describe("private manager migration endpoints", () => {
  it("blocks normal operations until a validated pair is imported, then reads the restored evidence after reconstruction", async () => {
    const ctx = fixture();
    expect((await ctx.target().fetch(listProjects())).status).toBe(503);
    const result = await ctx.target().fetch(importRequest(ctx.pair));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ ok: true });
    const list = await ctx.target().fetch(listProjects());
    expect(list.status).toBe(200);
    expect((await list.json()).result.data).toEqual([
      expect.objectContaining({ id: ctx.project.id, name: "Imported project" }),
    ]);
    ctx.restart();
    const response = await ctx
      .target()
      .fetch(readEvidence(ctx.project.id, ctx.record.documentRef));
    expect(response.status).toBe(200);
    expect((await response.json()).result.data).toMatchObject({
      documentRef: ctx.record.documentRef,
      markdown: ctx.record.markdown,
      checksum: ctx.record.checksum,
    });
  });

  it("rejects absent or wrong service and migration credentials and browser origins", async () => {
    const ctx = fixture();
    const candidates: HeadersInit[] = [
      {},
      migrationHeaders,
      { ...migrationHeaders, "x-migration-token": "wrong" },
      { ...headers, "x-migration-token": serviceToken },
      { ...migrationHeaders, origin: "https://untrusted.example" },
    ];
    for (const [i, candidate] of candidates.entries()) {
      if (i === 1) continue;
      const response = await ctx
        .target()
        .fetch(importRequest(ctx.pair, candidate));
      expect([401, 404]).toContain(response.status);
      expect(await response.text()).not.toContain(ctx.record.markdown);
    }
    expect(ctx.evidenceFetch).not.toHaveBeenCalled();
    expect((await ctx.target().fetch(listProjects())).status).toBe(503);
  });

  it("rejects tampered data and mismatched source identities without unlocking", async () => {
    const ctx = fixture();
    ctx.pair.evidence.tables[0].rows[0][5] = "tampered";
    const response = await ctx.target().fetch(importRequest(ctx.pair));
    expect(response.status).toBe(409);
    expect(ctx.evidenceFetch).not.toHaveBeenCalled();
    expect((await ctx.target().fetch(listProjects())).status).toBe(503);
  });

  it("stays locked after a lost evidence restore acknowledgement and resumes the same pair after restart", async () => {
    const ctx = fixture();
    ctx.loseRestoreAcknowledgement();
    expect((await ctx.target().fetch(importRequest(ctx.pair))).status).toBe(
      409,
    );
    expect((await ctx.target().fetch(listProjects())).status).toBe(503);
    expect(
      (
        await ctx.destinationManager.storage.get<{ phase: string }>(
          "stage2-migration",
        )
      )?.phase,
    ).toBe("locked");
    ctx.restart();
    expect((await ctx.target().fetch(listProjects())).status).toBe(503);
    expect((await ctx.target().fetch(importRequest(ctx.pair))).status).toBe(
      200,
    );
    expect(
      (
        await ctx.destinationManager.storage.get<{ phase: string }>(
          "stage2-migration",
        )
      )?.phase,
    ).toBe("complete");
    expect(
      (
        await ctx
          .target()
          .fetch(readEvidence(ctx.project.id, ctx.record.documentRef))
      ).status,
    ).toBe(200);
  });

  it("rejects a conflicting populated destination and stays locked after restart", async () => {
    const ctx = fixture();
    const conflict = new DurableManagerStore(
      ctx.destinationManager.storage,
    ).create("Conflict");
    expect((await ctx.target().fetch(importRequest(ctx.pair))).status).toBe(
      409,
    );
    expect(
      (
        await ctx.destinationManager.storage.get<{ phase: string }>(
          "stage2-migration",
        )
      )?.phase,
    ).toBeUndefined();
    expect(
      ctx.destinationEvidence.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_evidence'",
        )
        .all(),
    ).toEqual([]);
    ctx.restart();
    expect((await ctx.target().fetch(listProjects())).status).toBe(503);
    expect((await ctx.target().fetch(importRequest(ctx.pair))).status).toBe(
      409,
    );
    expect(
      ctx.destinationManager.db.prepare("SELECT id FROM projects").all(),
    ).toEqual([{ id: conflict.id }]);
  });

  it("does not run startup recovery or change evidence when a conflicting target has active work", async () => {
    const ctx = fixture();
    const store = new DurableManagerStore(ctx.destinationManager.storage);
    const project = store.create("Active conflict");
    project.notes.push({
      id: "pending",
      sourceId: "pending",
      sourceVersion: "1",
      markdown: "pending",
      sourceDate: null,
      checksum: "checksum",
      documentRef: null,
      status: "extracting",
      indexStatus: null,
      runId: "run",
      error: null,
    });
    store.save(project);
    store.saveRun({
      id: "run",
      projectId: project.id,
      action: "intake",
      status: "running",
      input: null,
      output: null,
      error: null,
      spans: [],
      startedAt: "2026-11-02T00:00:00.000Z",
      endedAt: null,
    });
    const beforeProjects = ctx.destinationManager.db
      .prepare("SELECT * FROM projects")
      .all();
    const beforeRuns = ctx.destinationManager.db
      .prepare("SELECT * FROM runs")
      .all();
    ctx.restart();
    expect((await ctx.target().fetch(listProjects())).status).toBe(503);
    expect((await ctx.target().fetch(importRequest(ctx.pair))).status).toBe(
      409,
    );
    expect(
      ctx.destinationManager.db.prepare("SELECT * FROM projects").all(),
    ).toEqual(beforeProjects);
    expect(
      ctx.destinationManager.db.prepare("SELECT * FROM runs").all(),
    ).toEqual(beforeRuns);
    expect(
      await ctx.destinationManager.storage.get("stage2-migration"),
    ).toBeUndefined();
    expect(
      ctx.destinationEvidence.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_evidence'",
        )
        .all(),
    ).toEqual([]);
  });

  it("only enables migration in explicit required mode with a distinct secret", async () => {
    const ctx = fixture();
    const badEnvs = [
      { ...ctx.env, MANAGER_IMPORT_MODE: "false" },
      { ...ctx.env, MANAGER_MIGRATION_TOKEN: serviceToken },
      { ...ctx.env, MANAGER_MIGRATION_TOKEN: undefined },
    ];
    for (const env of badEnvs) {
      const state = {
        storage: ctx.destinationManager.storage,
        blockConcurrencyWhile: async <T>(operation: () => Promise<T>) =>
          operation(),
      };
      const manager = new DurableManagerObject(state, env);
      expect((await manager.fetch(importRequest(ctx.pair))).status).toBe(404);
    }
    expect(ctx.evidenceFetch).not.toHaveBeenCalled();
  });

  it("fails closed for invalid import mode settings", async () => {
    const ctx = fixture();
    for (const mode of ["", "false", "true", "invalid"]) {
      const state = {
        storage: ctx.destinationManager.storage,
        blockConcurrencyWhile: async <T>(operation: () => Promise<T>) =>
          operation(),
      };
      const manager = new DurableManagerObject(state, {
        ...ctx.env,
        MANAGER_IMPORT_MODE: mode,
      });
      expect((await manager.fetch(importRequest(ctx.pair))).status).toBe(404);
      expect((await manager.fetch(listProjects())).status).toBe(503);
    }
    expect(ctx.evidenceFetch).not.toHaveBeenCalled();
  });

  it("protects the evidence migration operations with the separate secret", async () => {
    const ctx = fixture();
    const evidence = new DurableEvidenceObject(
      { storage: ctx.destinationEvidence.storage },
      baseEnv,
    );
    for (const path of ["digest", "restore"]) {
      for (const requestHeaders of [
        headers,
        { ...headers, "x-migration-token": "wrong" },
      ]) {
        const response = await evidence.fetch(
          new Request(`https://evidence.internal/migration/${path}`, {
            method: "POST",
            headers: requestHeaders,
            body:
              path === "restore"
                ? JSON.stringify(ctx.pair.evidence)
                : undefined,
          }),
        );
        expect(response.status).toBe(404);
      }
    }
    expect(
      ctx.destinationEvidence.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_evidence'",
        )
        .all(),
    ).toEqual([]);
  });
});
