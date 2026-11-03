import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { DurableEvidenceStore } from "../../../ingest-classifier/src/evidence/durable-store.ts";
import type { DurableSqlStorage } from "../storage/sql-driver.ts";
import { DurableEvidenceObject } from "./evidence-object.ts";

const token = "fixture-service-token-0123456789-abcdefgh";
const owner = "16949569";
const env = { MANAGER_SERVICE_TOKEN: token, MANAGER_OWNER_ID: owner };
const headers = { authorization: `Bearer ${token}`, "x-manager-actor": owner };
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

/** SQLite stand-in; the separate local Workers fixture covers runtime compatibility. */
function setup() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  const storage: DurableSqlStorage = {
    sql: {
      exec(query, ...values) {
        if (/^\s*CREATE TABLE IF NOT EXISTS project_evidence/i.test(query)) {
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
  const evidence = new DurableEvidenceStore(storage);
  const record = evidence.register({
    projectId: "project-one",
    sourceId: "source-one",
    sourceVersion: "v1",
    idempotencyKey: "retry-one",
    markdown: "Private evidence 😀\n",
    sourceDate: "2026-11-02",
  });
  return {
    database,
    storage,
    record,
    service: new DurableEvidenceObject({ storage }, env),
  };
}

function read(
  body: unknown,
  requestHeaders: HeadersInit = headers,
  path = "/read",
  method = "POST",
) {
  return new Request(`https://evidence.internal${path}`, {
    method,
    headers: requestHeaders,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

describe("private durable evidence service", () => {
  it("fails closed on missing or invalid service configuration", () => {
    const { storage } = setup();
    for (const invalid of [
      {},
      { MANAGER_SERVICE_TOKEN: "short", MANAGER_OWNER_ID: owner },
      { MANAGER_SERVICE_TOKEN: token, MANAGER_OWNER_ID: "0" },
    ]) {
      expect(() => new DurableEvidenceObject({ storage }, invalid)).toThrow();
    }
  });

  it("returns exact immutable evidence to the authorized owner and persists on reconstruction", async () => {
    const { service, storage, record } = setup();
    const input = {
      projectId: record.projectId,
      documentRef: record.documentRef,
    };
    for (const current of [
      service,
      new DurableEvidenceObject({ storage }, env),
    ]) {
      const response = await current.fetch(read(input));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({
        projectId: record.projectId,
        documentRef: record.documentRef,
        sourceId: record.sourceId,
        sourceVersion: record.sourceVersion,
        checksum: record.checksum,
        markdown: record.markdown,
        sourceDate: record.sourceDate,
      });
    }
  });

  it("rejects unauthorized requests without exposing evidence or credentials", async () => {
    const { service, record } = setup();
    const variants: HeadersInit[] = [
      {},
      { authorization: `Bearer ${token}` },
      { ...headers, authorization: `Bearer ${token}wrong` },
      { ...headers, "x-manager-actor": "999999" },
      { ...headers, origin: "https://untrusted.example" },
      { ...headers, origin: "null" },
    ];
    for (const variant of variants) {
      const response = await service.fetch(
        read(
          { projectId: record.projectId, documentRef: record.documentRef },
          variant,
        ),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.text();
      expect(body).not.toContain(token);
      expect(body).not.toContain(record.markdown);
    }
  });

  it("does not disclose a source to another project or for an unknown reference", async () => {
    const { service, record } = setup();
    for (const input of [
      { projectId: "project-two", documentRef: record.documentRef },
      { projectId: record.projectId, documentRef: "missing" },
    ]) {
      const response = await service.fetch(read(input));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain(record.markdown);
    }
  });

  it("rejects malformed, extra, oversized or unsupported requests without mutating evidence", async () => {
    const { service, database, record } = setup();
    const before = database.prepare("SELECT * FROM project_evidence").all();
    for (const input of [
      {},
      { projectId: "", documentRef: record.documentRef },
      {
        projectId: record.projectId,
        documentRef: record.documentRef,
        unexpected: true,
      },
    ]) {
      expect((await service.fetch(read(input))).status).toBe(400);
    }
    const malformed = new Request("https://evidence.internal/read", {
      method: "POST",
      headers,
      body: "{",
    });
    expect((await service.fetch(malformed)).status).toBe(400);
    expect(
      (
        await service.fetch(
          read({
            projectId: "x".repeat(5000),
            documentRef: record.documentRef,
          }),
        )
      ).status,
    ).toBe(413);
    expect((await service.fetch(read({}, headers, "/write"))).status).toBe(404);
    expect(
      (await service.fetch(read({}, headers, "/read", "GET"))).status,
    ).toBe(404);
    expect(database.prepare("SELECT * FROM project_evidence").all()).toEqual(
      before,
    );
  });
});
