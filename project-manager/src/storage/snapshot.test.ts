import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceCoreStore } from "../../../ingest-classifier/src/evidence/core-store.ts";
import { nodeEvidenceDriver } from "../../../ingest-classifier/src/evidence/sql-driver.ts";
import { ManagerStore } from "./manager-store.ts";
import {
  captureSnapshot,
  restoreSnapshot,
  validateSnapshotPair,
} from "./snapshot.ts";
import { createNodeSqlDriver } from "./sql-driver.ts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup(kind: "manager" | "evidence") {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  const driver = createNodeSqlDriver(db);
  if (kind === "manager") new ManagerStore(driver);
  else new EvidenceCoreStore(nodeEvidenceDriver(db));
  return { db, driver };
}

function addEvidence(db: DatabaseSync) {
  const evidence = new EvidenceCoreStore(nodeEvidenceDriver(db));
  const input = {
    projectId: "project-one",
    sourceId: "meeting",
    sourceVersion: "v1",
    idempotencyKey: "key-one",
    markdown: "Notes 😀\nSecond paragraph",
    sourceDate: "2026-11-02",
  };
  const record = evidence.register(input);
  evidence.ensureChunks(record);
  return record;
}

describe("offline storage snapshots", () => {
  it("round-trips manager projects and delivery state into an empty database", () => {
    const source = setup("manager");
    const target = setup("manager");
    source.db.exec(`INSERT INTO projects VALUES ('project-1', '{"name":"Atlas"}');
      INSERT INTO runs VALUES ('run-1', '{"status":"success"}');
      INSERT INTO delivery_repositories VALUES ('repo-1', '{"name":"repo"}', 2, 'ready');
      INSERT INTO delivery_outbox VALUES ('intent-1', 'repo-1', 'key-1', 'fake', 2, 'queued', NULL, NULL);
      INSERT INTO delivery_work_items VALUES ('repo-1', 17, 1, '{"title":"work"}');
      INSERT INTO delivery_jobs VALUES ('job-1', 'repo-1', 'fake', 'queued', NULL, NULL);`);
    const snapshot = captureSnapshot(source.driver, "manager");
    restoreSnapshot(target.driver, snapshot);
    expect(captureSnapshot(target.driver, "manager")).toEqual(snapshot);
    expect(target.db.prepare("SELECT * FROM delivery_outbox").all()).toEqual([
      expect.objectContaining({
        id: "intent-1",
        repository_id: "repo-1",
        operation_key: "key-1",
      }),
    ]);
  });

  it("preserves immutable evidence, retry keys, chunks, and Unicode text", () => {
    const source = setup("evidence");
    const target = setup("evidence");
    const original = addEvidence(source.db);
    const snapshot = captureSnapshot(source.driver, "evidence");
    restoreSnapshot(target.driver, snapshot);
    expect(captureSnapshot(target.driver, "evidence")).toEqual(snapshot);
    const restored = new EvidenceCoreStore(nodeEvidenceDriver(target.db));
    expect(restored.get("project-one", original.documentRef)).toEqual(original);
    expect(restored.get("other-project", original.documentRef)).toBeNull();
    expect(restored.chunks("project-one", original.documentRef)).toHaveLength(
      1,
    );
  });

  it("rejects a changed payload and leaves the destination empty", () => {
    const source = setup("manager");
    const target = setup("manager");
    source.db.exec("INSERT INTO projects VALUES ('p1', '{}')");
    const snapshot = captureSnapshot(source.driver, "manager");
    snapshot.tables[0].rows[0][1] = '{"changed":true}';
    expect(() => restoreSnapshot(target.driver, snapshot)).toThrow(/checksum/i);
    expect(target.db.prepare("SELECT * FROM projects").all()).toEqual([]);
  });

  it("rejects an evidence source whose checksum does not match its contents", () => {
    const source = setup("evidence");
    addEvidence(source.db);
    source.db.exec("UPDATE project_evidence SET markdown = 'tampered'");
    expect(() => captureSnapshot(source.driver, "evidence")).toThrow(
      /evidence checksum/i,
    );
  });

  it("rejects a nonempty destination without changing existing data", () => {
    const source = setup("manager");
    const target = setup("manager");
    source.db.exec("INSERT INTO projects VALUES ('source', '{}')");
    target.db.exec("INSERT INTO projects VALUES ('existing', '{}')");
    expect(() =>
      restoreSnapshot(target.driver, captureSnapshot(source.driver, "manager")),
    ).toThrow(/not empty/i);
    expect(target.db.prepare("SELECT id FROM projects").all()).toEqual([
      { id: "existing" },
    ]);
  });

  it("rolls back all destination writes if a later table insert fails", () => {
    const source = setup("evidence");
    const target = setup("evidence");
    addEvidence(source.db);
    const snapshot = captureSnapshot(source.driver, "evidence");
    target.db.exec(
      "CREATE TRIGGER reject_key BEFORE INSERT ON project_evidence_keys BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    expect(() => restoreSnapshot(target.driver, snapshot)).toThrow(
      "fixture failure",
    );
    expect(target.db.prepare("SELECT * FROM project_evidence").all()).toEqual(
      [],
    );
    expect(
      target.db.prepare("SELECT * FROM project_evidence_keys").all(),
    ).toEqual([]);
  });

  it("rejects unsupported schemas and manager migration versions", () => {
    const source = setup("manager");
    source.db.exec("INSERT INTO manager_migrations VALUES (3)");
    expect(() => captureSnapshot(source.driver, "manager")).toThrow(
      /migration version/i,
    );
    const extra = setup("manager");
    extra.db.exec("CREATE TABLE unexpected_application_data (id TEXT)");
    expect(() => captureSnapshot(extra.driver, "manager")).toThrow(
      /unsupported manager tables/i,
    );
    const evidence = setup("evidence");
    evidence.db.exec("ALTER TABLE project_evidence ADD COLUMN unexpected TEXT");
    expect(() => captureSnapshot(evidence.driver, "evidence")).toThrow(
      /unsupported schema/i,
    );
  });

  it("rejects missing unique and foreign-key constraints with unchanged columns", () => {
    for (const missing of ["unique", "foreign"] as const) {
      const source = setup("manager");
      source.db.exec(`DROP TABLE delivery_outbox;
        CREATE TABLE delivery_outbox (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL ${missing === "foreign" ? "" : "REFERENCES delivery_repositories(id)"},
          operation_key TEXT NOT NULL ${missing === "unique" ? "" : "UNIQUE"},
          kind TEXT NOT NULL,
          revision INTEGER NOT NULL,
          status TEXT NOT NULL,
          attempt_id TEXT,
          lease_expires_at TEXT
        );`);
      expect(() => captureSnapshot(source.driver, "manager")).toThrow(
        /unsupported (unique keys|foreign keys)/i,
      );
    }
  });

  it("checks evidence content even when the outer snapshot digest is recomputed", () => {
    const source = setup("evidence");
    const target = setup("evidence");
    addEvidence(source.db);
    const snapshot = captureSnapshot(source.driver, "evidence");
    snapshot.tables[0].rows[0][5] = "different content";
    snapshot.sha256 = createHash("sha256")
      .update(
        JSON.stringify({
          version: snapshot.version,
          kind: snapshot.kind,
          tables: snapshot.tables,
        }),
      )
      .digest("hex");
    expect(() => restoreSnapshot(target.driver, snapshot)).toThrow(
      /evidence checksum/i,
    );
    expect(target.db.prepare("SELECT * FROM project_evidence").all()).toEqual(
      [],
    );
  });
});

describe("paired manager and evidence snapshots", () => {
  it("accepts matching immutable evidence and rejects missing or mismatched sources", () => {
    const manager = setup("manager");
    const evidence = setup("evidence");
    const record = addEvidence(evidence.db);
    const note = {
      documentRef: record.documentRef,
      sourceId: record.sourceId,
      sourceVersion: record.sourceVersion,
      checksum: record.checksum,
      sourceDate: record.sourceDate,
      markdown: record.markdown,
    };
    const insert = manager.db.prepare("INSERT INTO projects VALUES (?, ?)");
    insert.run(
      "project-one",
      JSON.stringify({ id: "project-one", notes: [note] }),
    );
    const evidenceSnapshot = captureSnapshot(evidence.driver, "evidence");
    expect(() =>
      validateSnapshotPair(
        captureSnapshot(manager.driver, "manager"),
        evidenceSnapshot,
      ),
    ).not.toThrow();
    for (const [field, value] of Object.entries({
      documentRef: "missing",
      sourceId: "other",
      sourceVersion: "v2",
      checksum: "different",
      sourceDate: null,
      markdown: "changed",
    })) {
      manager.db.prepare("UPDATE projects SET data = ? WHERE id = ?").run(
        JSON.stringify({
          id: "project-one",
          notes: [{ ...note, [field]: value }],
        }),
        "project-one",
      );
      expect(() =>
        validateSnapshotPair(
          captureSnapshot(manager.driver, "manager"),
          evidenceSnapshot,
        ),
      ).toThrow(/do not match/i);
    }
  });

  it("rejects evidence belonging to another project and permits notes not yet stored", () => {
    const manager = setup("manager");
    const evidence = setup("evidence");
    const record = addEvidence(evidence.db);
    const insert = manager.db.prepare("INSERT INTO projects VALUES (?, ?)");
    insert.run(
      "other-project",
      JSON.stringify({ id: "other-project", notes: [{ ...record }] }),
    );
    const evidenceSnapshot = captureSnapshot(evidence.driver, "evidence");
    expect(() =>
      validateSnapshotPair(
        captureSnapshot(manager.driver, "manager"),
        evidenceSnapshot,
      ),
    ).toThrow(/do not match/i);
    manager.db
      .prepare("UPDATE projects SET data = ? WHERE id = ?")
      .run(
        JSON.stringify({ id: "other-project", notes: [{ documentRef: null }] }),
        "other-project",
      );
    expect(() =>
      validateSnapshotPair(
        captureSnapshot(manager.driver, "manager"),
        evidenceSnapshot,
      ),
    ).not.toThrow();
  });
});
