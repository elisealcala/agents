import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceCoreStore } from "../../../ingest-classifier/src/evidence/core-store.ts";
import { nodeEvidenceDriver } from "../../../ingest-classifier/src/evidence/sql-driver.ts";
import { ManagerStore } from "../storage/manager-store.ts";
import {
  captureSnapshot,
  restoreSnapshot,
  type Snapshot,
} from "../storage/snapshot.ts";
import { createNodeSqlDriver } from "../storage/sql-driver.ts";
import {
  type MigrationDependencies,
  type MigrationMarker,
  migrateSnapshotPair,
} from "./migration.ts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(kind: "manager" | "evidence") {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  const driver = createNodeSqlDriver(db);
  if (kind === "manager") new ManagerStore(driver);
  else new EvidenceCoreStore(nodeEvidenceDriver(db));
  return { db, driver };
}

function fixture() {
  const managerSource = database("manager");
  const evidenceSource = database("evidence");
  const evidence = new EvidenceCoreStore(nodeEvidenceDriver(evidenceSource.db));
  const source = evidence.register({
    projectId: "project-1",
    sourceId: "source-1",
    sourceVersion: "v1",
    idempotencyKey: "retry-1",
    markdown: "Original source 😀",
    sourceDate: "2026-11-02",
  });
  evidence.ensureChunks(source);
  managerSource.db.prepare("INSERT INTO projects VALUES (?, ?)").run(
    source.projectId,
    JSON.stringify({
      id: source.projectId,
      notes: [{ ...source, status: "review" }],
    }),
  );
  const pair = {
    manager: captureSnapshot(managerSource.driver, "manager"),
    evidence: captureSnapshot(evidenceSource.driver, "evidence"),
  };
  const managerTarget = database("manager");
  const evidenceTarget = database("evidence");
  let marker: MigrationMarker | null = null;
  const events: string[] = [];
  let tail = Promise.resolve();
  const deps: MigrationDependencies = {
    async runExclusive(operation) {
      events.push("exclusive");
      const before = tail;
      let release: () => void = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await before;
      try {
        return await operation();
      } finally {
        release();
      }
    },
    async loadMarker() {
      events.push("load");
      return marker && { ...marker };
    },
    async saveMarker(value) {
      events.push(`save:${value.phase}`);
      marker = { ...value };
    },
    async preflightManager(snapshot) {
      events.push("preflight:manager");
      const current = captureSnapshot(managerTarget.driver, "manager");
      if (
        current.sha256 !== snapshot.sha256 &&
        current.tables.some((table) => table.rows.length)
      )
        throw new Error("Manager destination is not empty");
    },
    async preflightEvidence(snapshot) {
      events.push("preflight:evidence");
      const current = captureSnapshot(evidenceTarget.driver, "evidence");
      if (
        current.sha256 !== snapshot.sha256 &&
        current.tables.some((table) => table.rows.length)
      )
        throw new Error("Evidence destination is not empty");
    },
    async readEvidenceDigest() {
      events.push("read:evidence");
      return captureSnapshot(evidenceTarget.driver, "evidence").sha256;
    },
    async restoreEvidence(snapshot: Snapshot) {
      events.push("restore:evidence");
      restoreSnapshot(evidenceTarget.driver, snapshot);
    },
    async readManagerDigest() {
      events.push("read:manager");
      return captureSnapshot(managerTarget.driver, "manager").sha256;
    },
    async restoreManager(snapshot: Snapshot) {
      events.push("restore:manager");
      restoreSnapshot(managerTarget.driver, snapshot);
    },
  };
  return {
    pair,
    deps,
    events,
    managerSource,
    managerTarget,
    evidenceTarget,
    marker: () => marker,
    setMarker: (value: MigrationMarker) => {
      marker = value;
    },
  };
}

describe("two-store migration", () => {
  it("locks before restoring evidence and manager, verifies both and marks completion", async () => {
    const ctx = fixture();
    await migrateSnapshotPair(ctx.pair, ctx.deps);
    expect(ctx.marker()).toEqual({
      version: 1,
      manager: ctx.pair.manager.sha256,
      evidence: ctx.pair.evidence.sha256,
      phase: "complete",
    });
    expect(ctx.events).toEqual([
      "exclusive",
      "load",
      "preflight:manager",
      "preflight:evidence",
      "save:locked",
      "read:evidence",
      "restore:evidence",
      "read:evidence",
      "save:evidence",
      "read:manager",
      "restore:manager",
      "read:manager",
      "save:complete",
    ]);
    expect(captureSnapshot(ctx.managerTarget.driver, "manager")).toEqual(
      ctx.pair.manager,
    );
    expect(captureSnapshot(ctx.evidenceTarget.driver, "evidence")).toEqual(
      ctx.pair.evidence,
    );
  });

  it("validates a corrupted or mismatched pair before acquiring a lock or writing", async () => {
    const corrupted = fixture();
    corrupted.pair.evidence.tables[0].rows[0][5] = "tampered";
    await expect(
      migrateSnapshotPair(corrupted.pair, corrupted.deps),
    ).rejects.toThrow();
    expect(corrupted.events).toEqual([]);
    expect(corrupted.marker()).toBeNull();
    const mismatch = fixture();
    const other = fixture();
    await expect(
      migrateSnapshotPair(
        { manager: mismatch.pair.manager, evidence: other.pair.evidence },
        mismatch.deps,
      ),
    ).rejects.toThrow();
    expect(mismatch.events).toEqual([]);
    expect(mismatch.marker()).toBeNull();
  });

  it("resumes after evidence was restored but saving its phase failed", async () => {
    const ctx = fixture();
    const save = ctx.deps.saveMarker;
    let failed = false;
    ctx.deps.saveMarker = async (value) => {
      if (value.phase === "evidence" && !failed) {
        failed = true;
        throw new Error("interrupted");
      }
      await save(value);
    };
    await expect(migrateSnapshotPair(ctx.pair, ctx.deps)).rejects.toThrow(
      "interrupted",
    );
    expect(ctx.marker()?.phase).toBe("locked");
    expect(captureSnapshot(ctx.evidenceTarget.driver, "evidence")).toEqual(
      ctx.pair.evidence,
    );
    expect(ctx.events).not.toContain("restore:manager");
    ctx.events.length = 0;
    await migrateSnapshotPair(ctx.pair, ctx.deps);
    expect(ctx.events).not.toContain("restore:evidence");
    expect(ctx.marker()?.phase).toBe("complete");
  });

  it("resumes after manager was restored but the completion marker failed to save", async () => {
    const ctx = fixture();
    const save = ctx.deps.saveMarker;
    let failed = false;
    ctx.deps.saveMarker = async (value) => {
      if (value.phase === "complete" && !failed) {
        failed = true;
        throw new Error("interrupted");
      }
      await save(value);
    };
    await expect(migrateSnapshotPair(ctx.pair, ctx.deps)).rejects.toThrow(
      "interrupted",
    );
    expect(ctx.marker()?.phase).toBe("evidence");
    expect(captureSnapshot(ctx.managerTarget.driver, "manager")).toEqual(
      ctx.pair.manager,
    );
    ctx.events.length = 0;
    await migrateSnapshotPair(ctx.pair, ctx.deps);
    expect(ctx.events).not.toContain("restore:manager");
    expect(ctx.events).not.toContain("restore:evidence");
    expect(ctx.marker()?.phase).toBe("complete");
  });

  it("recovers when a marker write succeeds but its acknowledgement is lost", async () => {
    for (const phase of ["locked", "evidence", "complete"] as const) {
      const ctx = fixture();
      const save = ctx.deps.saveMarker;
      let failed = false;
      ctx.deps.saveMarker = async (value) => {
        await save(value);
        if (value.phase === phase && !failed) {
          failed = true;
          throw new Error("acknowledgement lost");
        }
      };
      await expect(migrateSnapshotPair(ctx.pair, ctx.deps)).rejects.toThrow(
        "acknowledgement lost",
      );
      expect(ctx.marker()?.phase).toBe(phase);
      await migrateSnapshotPair(ctx.pair, ctx.deps);
      expect(ctx.marker()?.phase).toBe("complete");
      expect(captureSnapshot(ctx.managerTarget.driver, "manager")).toEqual(
        ctx.pair.manager,
      );
      expect(captureSnapshot(ctx.evidenceTarget.driver, "evidence")).toEqual(
        ctx.pair.evidence,
      );
    }
  });

  it("rejects snapshots with active work before acquiring a lock", async () => {
    for (const kind of ["run", "note", "outbox", "job"] as const) {
      const ctx = fixture();
      const db = ctx.managerSource.db;
      if (kind === "run")
        db.prepare("INSERT INTO runs VALUES (?, ?)").run(
          "run",
          JSON.stringify({ status: "running" }),
        );
      if (kind === "note") {
        const row = db
          .prepare("SELECT data FROM projects WHERE id = ?")
          .get("project-1") as { data: string };
        const project = JSON.parse(row.data);
        project.notes[0].status = "extracting";
        db.prepare("UPDATE projects SET data = ? WHERE id = ?").run(
          JSON.stringify(project),
          "project-1",
        );
      }
      if (kind === "outbox" || kind === "job") {
        db.exec(
          "INSERT INTO delivery_repositories VALUES ('repo', '{}', 1, 'ready')",
        );
        if (kind === "outbox")
          db.exec(
            "INSERT INTO delivery_outbox VALUES ('intent', 'repo', 'op', 'fake', 1, 'dispatching', 'attempt', '2026-11-03T00:00:00Z')",
          );
        else
          db.exec(
            "INSERT INTO delivery_jobs VALUES ('job', 'repo', 'fake', 'running', 'attempt', '2026-11-03T00:00:00Z')",
          );
      }
      ctx.pair.manager = captureSnapshot(ctx.managerSource.driver, "manager");
      await expect(migrateSnapshotPair(ctx.pair, ctx.deps)).rejects.toThrow(
        /stopped/i,
      );
      expect(ctx.events).toEqual([]);
      expect(ctx.marker()).toBeNull();
    }
  });

  it("rejects conflicting destination data before locking or restoring either store", async () => {
    for (const kind of ["manager", "evidence"] as const) {
      const ctx = fixture();
      if (kind === "manager")
        ctx.managerTarget.db.exec(
          "INSERT INTO projects VALUES ('different', '{}')",
        );
      else
        new EvidenceCoreStore(
          nodeEvidenceDriver(ctx.evidenceTarget.db),
        ).register({
          projectId: "other",
          sourceId: "other",
          sourceVersion: "1",
          idempotencyKey: "other",
          markdown: "existing",
        });
      await expect(migrateSnapshotPair(ctx.pair, ctx.deps)).rejects.toThrow(
        /not empty/i,
      );
      expect(ctx.marker()).toBeNull();
      expect(ctx.events).not.toContain("restore:evidence");
      expect(ctx.events).not.toContain("restore:manager");
    }
  });

  it("rejects a different or malformed recorded migration without touching either store", async () => {
    for (const stored of [
      { version: 1, manager: "other", evidence: "other", phase: "locked" },
      { version: 7, manager: "other", evidence: "other", phase: "complete" },
    ]) {
      const ctx = fixture();
      ctx.setMarker(stored as MigrationMarker);
      await expect(migrateSnapshotPair(ctx.pair, ctx.deps)).rejects.toThrow(
        /different or invalid/i,
      );
      expect(ctx.events).toEqual(["exclusive", "load"]);
    }
  });

  it("treats complete as terminal, even after normal application writes", async () => {
    const ctx = fixture();
    await migrateSnapshotPair(ctx.pair, ctx.deps);
    ctx.managerTarget.db.exec("INSERT INTO projects VALUES ('later', '{}')");
    ctx.events.length = 0;
    await migrateSnapshotPair(ctx.pair, ctx.deps);
    expect(ctx.events).toEqual(["exclusive", "load"]);
    expect(
      ctx.managerTarget.db.prepare("SELECT id FROM projects ORDER BY id").all(),
    ).toEqual([{ id: "later" }, { id: "project-1" }]);
  });

  it("does not complete when either restored digest cannot be verified", async () => {
    for (const kind of ["manager", "evidence"] as const) {
      const ctx = fixture();
      if (kind === "manager") ctx.deps.readManagerDigest = async () => "wrong";
      else ctx.deps.readEvidenceDigest = async () => "wrong";
      await expect(migrateSnapshotPair(ctx.pair, ctx.deps)).rejects.toThrow(
        /verification failed/i,
      );
      expect(ctx.marker()?.phase).toBe(
        kind === "manager" ? "evidence" : "locked",
      );
    }
  });

  it("serializes simultaneous imports so the second observes the completed marker", async () => {
    const ctx = fixture();
    await Promise.all([
      migrateSnapshotPair(ctx.pair, ctx.deps),
      migrateSnapshotPair(ctx.pair, ctx.deps),
    ]);
    expect(ctx.marker()?.phase).toBe("complete");
    expect(
      ctx.events.filter((value) => value === "restore:evidence"),
    ).toHaveLength(1);
    expect(
      ctx.events.filter((value) => value === "restore:manager"),
    ).toHaveLength(1);
  });
});
