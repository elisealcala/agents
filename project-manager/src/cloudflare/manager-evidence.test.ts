import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableEvidenceStore } from "../../../ingest-classifier/src/evidence/durable-store.ts";
import { DurableManagerStore } from "../storage/durable-manager-store.ts";
import type { DurableSqlStorage } from "../storage/sql-driver.ts";
import { DurableEvidenceObject } from "./evidence-object.ts";
import { DurableManagerObject } from "./manager-object.ts";

const token = "fixture-service-token-0123456789-abcdefgh";
const owner = "16949569";
const env = { MANAGER_SERVICE_TOKEN: token, MANAGER_OWNER_ID: owner };
const headers = { authorization: `Bearer ${token}`, "x-manager-actor": owner };
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function makeStorage(): DurableSqlStorage {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  return {
    sql: {
      exec(query, ...values) {
        if (/^\s*CREATE\b/i.test(query) && values.length === 0) {
          database.exec(query);
          return { toArray: () => [], rowsWritten: 0 };
        }
        const statement = database.prepare(query);
        if (statement.columns().length) {
          const rows = statement.all(...values);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        const result = statement.run(...values);
        return { toArray: () => [], rowsWritten: Number(result.changes) };
      },
    },
    transactionSync<T>(operation: () => T): T {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function setup() {
  const managerStorage = makeStorage();
  const evidenceStorage = makeStorage();
  const store = new DurableManagerStore(managerStorage);
  const project = store.create("Fixture project");
  const other = store.create("Other project");
  const evidenceStore = new DurableEvidenceStore(evidenceStorage);
  const record = evidenceStore.register({
    projectId: project.id,
    sourceId: "source",
    sourceVersion: "v1",
    idempotencyKey: "key",
    markdown: "Private 😀 evidence",
    sourceDate: "2026-11-02",
  });
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
  store.save(project);
  const evidence = new DurableEvidenceObject({ storage: evidenceStorage }, env);
  const fetchEvidence = vi.fn((request: Request) => evidence.fetch(request));
  const binding = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => ({ fetch: fetchEvidence })),
  };
  const manager = new DurableManagerObject(
    { storage: managerStorage },
    { ...env, EVIDENCE: binding },
  );
  return {
    manager,
    managerStorage,
    project,
    other,
    record,
    binding,
    fetchEvidence,
  };
}

function read(projectId: string, documentRef: string) {
  const input = encodeURIComponent(JSON.stringify({ projectId, documentRef }));
  return new Request(
    `https://manager.internal/trpc/evidence.read?input=${input}`,
    { headers },
  );
}

describe("hosted manager evidence binding", () => {
  it("reads a persisted source through the private evidence owner with verified service credentials", async () => {
    const { manager, project, record, binding, fetchEvidence } = setup();
    const response = await manager.fetch(read(project.id, record.documentRef));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).result.data).toMatchObject({
      projectId: project.id,
      documentRef: record.documentRef,
      markdown: record.markdown,
      checksum: record.checksum,
    });
    expect(binding.idFromName).toHaveBeenCalledWith("primary");
    const request = fetchEvidence.mock.calls[0][0];
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(request.headers.get("x-manager-actor")).toBe(owner);
    expect(request.headers.get("origin")).toBeNull();
  });

  it("rejects a project without the source before contacting the evidence owner", async () => {
    const { manager, other, record, fetchEvidence } = setup();
    const response = await manager.fetch(read(other.id, record.documentRef));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain(record.markdown);
    expect(fetchEvidence).not.toHaveBeenCalled();
  });

  it("fails closed when the private binding is missing", async () => {
    const { managerStorage, project, record } = setup();
    const manager = new DurableManagerObject({ storage: managerStorage }, env);
    const response = await manager.fetch(read(project.id, record.documentRef));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain(record.markdown);
  });

  it("rejects malformed or altered evidence responses", async () => {
    const { managerStorage, project, record } = setup();
    for (const data of [
      { invalid: true },
      { ...record, markdown: "altered" },
      { ...record, projectId: "other" },
    ]) {
      const binding = {
        idFromName: (name: string) => name,
        get: () => ({ fetch: async () => Response.json(data) }),
      };
      const manager = new DurableManagerObject(
        { storage: managerStorage },
        { ...env, EVIDENCE: binding },
      );
      const response = await manager.fetch(
        read(project.id, record.documentRef),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain(record.markdown);
    }
  });
});
