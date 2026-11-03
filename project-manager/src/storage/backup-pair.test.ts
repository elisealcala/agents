import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createBackupPair } from "./backup-pair.ts";
import { Store } from "./store.ts";

const roots: string[] = [];
const connections: DatabaseSync[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* The connection may not have an open transaction. */
    }
    db.close();
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function open(filename: string, readOnly = false) {
  const db = new DatabaseSync(filename, { readOnly });
  connections.push(db);
  return db;
}
function fixture() {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "backup-pair-test-")),
  );
  roots.push(root);
  const managerPath = path.join(root, "manager.sqlite");
  const evidencePath = path.join(root, "evidence.sqlite");
  const outputDirectory = path.join(root, "backups");
  const manager = open(managerPath);
  manager.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE projects(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE runs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE evaluations(id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  const project = JSON.stringify({
    id: "fixture-project",
    notes: [{ id: "note", status: "storing", markdown: "Before restore 😀" }],
  });
  const run = JSON.stringify({
    id: "fixture-run",
    status: "running",
    spans: [],
  });
  manager
    .prepare("INSERT INTO projects VALUES (?, ?)")
    .run("fixture-project", project);
  manager.prepare("INSERT INTO runs VALUES (?, ?)").run("fixture-run", run);
  const evidence = open(evidencePath);
  evidence.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE project_evidence(document_ref TEXT PRIMARY KEY, markdown TEXT NOT NULL);
    CREATE TABLE classifier_audit(id TEXT PRIMARY KEY, details TEXT NOT NULL);`);
  evidence
    .prepare("INSERT INTO project_evidence VALUES (?, ?)")
    .run("reference", "Evidence 😀");
  evidence
    .prepare("INSERT INTO classifier_audit VALUES (?, ?)")
    .run("audit", "retain this classifier data");
  return {
    root,
    managerPath,
    evidencePath,
    outputDirectory,
    manager,
    evidence,
    project,
    run,
  };
}

describe("offline complete paired database backups", () => {
  it("preserves stopped source database and WAL bytes while including committed data", async () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "backup-stopped-wal-")),
    );
    roots.push(root);
    const managerPath = path.join(root, "manager.sqlite");
    const evidencePath = path.join(root, "evidence.sqlite");
    const outputDirectory = path.join(root, "backups");
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { DatabaseSync } from "node:sqlite";
      const m = new DatabaseSync(process.argv[1]);
      const e = new DatabaseSync(process.argv[2]);
      m.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE projects(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE runs(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE evaluations(id TEXT PRIMARY KEY, data TEXT NOT NULL); INSERT INTO projects VALUES ('p', '{}');");
      e.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE original_evidence(id TEXT PRIMARY KEY); INSERT INTO original_evidence VALUES ('source');");
      process.exit(0);
    `,
        managerPath,
        evidencePath,
      ],
      { encoding: "utf8" },
    );
    expect(child.status).toBe(0);
    const sourceFiles = [
      managerPath,
      `${managerPath}-wal`,
      evidencePath,
      `${evidencePath}-wal`,
    ];
    const hash = (filename: string) =>
      createHash("sha256").update(readFileSync(filename)).digest("hex");
    const competingWriter = open(evidencePath);
    competingWriter.exec("BEGIN IMMEDIATE");
    const before = sourceFiles.map(hash);
    await expect(
      createBackupPair({ managerPath, evidencePath, outputDirectory }),
    ).rejects.toThrow();
    expect(sourceFiles.map(hash)).toEqual(before);
    competingWriter.exec("ROLLBACK");
    const result = await createBackupPair({
      managerPath,
      evidencePath,
      outputDirectory,
    });
    expect(sourceFiles.map(hash)).toEqual(before);
    expect(
      open(result.managerBackup, true).prepare("SELECT id FROM projects").all(),
    ).toEqual([{ id: "p" }]);
    expect(
      open(result.evidenceBackup, true)
        .prepare("SELECT id FROM original_evidence")
        .all(),
    ).toEqual([{ id: "source" }]);
  });
  it("captures committed WAL data and classifier tables while preserving original schema and state", async () => {
    const f = fixture();
    expect(existsSync(`${f.managerPath}-wal`)).toBe(true);
    expect(existsSync(`${f.evidencePath}-wal`)).toBe(true);
    const result = await createBackupPair(f);
    expect(result).toEqual({
      managerBackup: path.join(f.outputDirectory, "manager.original.sqlite"),
      evidenceBackup: path.join(f.outputDirectory, "evidence.original.sqlite"),
      stagedManager: path.join(f.outputDirectory, "manager.staged.sqlite"),
    });
    expect(statSync(f.outputDirectory).mode & 0o777).toBe(0o700);
    for (const filename of Object.values(result))
      expect(statSync(filename).mode & 0o777).toBe(0o600);
    const original = open(result.managerBackup, true);
    const staged = open(result.stagedManager, true);
    const evidence = open(result.evidenceBackup, true);
    expect(
      original
        .prepare("SELECT data FROM projects WHERE id = ?")
        .get("fixture-project"),
    ).toEqual({ data: f.project });
    expect(
      original.prepare("SELECT data FROM runs WHERE id = ?").get("fixture-run"),
    ).toEqual({ data: f.run });
    expect(
      original
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'manager_migrations'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      staged
        .prepare("SELECT version FROM manager_migrations ORDER BY version")
        .all(),
    ).toEqual([{ version: 1 }, { version: 2 }]);
    expect(
      staged
        .prepare("SELECT data FROM projects WHERE id = ?")
        .get("fixture-project"),
    ).toEqual({ data: f.project });
    expect(
      staged.prepare("SELECT data FROM runs WHERE id = ?").get("fixture-run"),
    ).toEqual({ data: f.run });
    expect(evidence.prepare("SELECT * FROM project_evidence").all()).toEqual([
      { document_ref: "reference", markdown: "Evidence 😀" },
    ]);
    expect(evidence.prepare("SELECT * FROM classifier_audit").all()).toEqual([
      { id: "audit", details: "retain this classifier data" },
    ]);
    expect(f.manager.prepare("SELECT data FROM projects").get()).toEqual({
      data: f.project,
    });
    expect(f.manager.prepare("SELECT data FROM runs").get()).toEqual({
      data: f.run,
    });
    expect(
      f.evidence.prepare("SELECT details FROM classifier_audit").get(),
    ).toEqual({ details: "retain this classifier data" });
  });

  it("refuses to overwrite an existing directory and preserves its contents", async () => {
    const f = fixture();
    const sentinel = path.join(f.root, "keep.txt");
    writeFileSync(sentinel, "untouched");
    await expect(
      createBackupPair({ ...f, outputDirectory: f.root }),
    ).rejects.toThrow();
    expect(readFileSync(sentinel, "utf8")).toBe("untouched");
    expect(f.manager.prepare("SELECT data FROM runs").get()).toEqual({
      data: f.run,
    });
  });

  it("rejects identical and missing sources without creating a destination", async () => {
    const f = fixture();
    await expect(
      createBackupPair({ ...f, evidencePath: f.managerPath }),
    ).rejects.toThrow(/distinct/i);
    expect(existsSync(f.outputDirectory)).toBe(false);
    const hardlink = path.join(f.root, "same-file.sqlite");
    linkSync(f.managerPath, hardlink);
    await expect(
      createBackupPair({ ...f, evidencePath: hardlink }),
    ).rejects.toThrow(/distinct/i);
    expect(existsSync(f.outputDirectory)).toBe(false);
    await expect(
      createBackupPair({
        ...f,
        evidencePath: path.join(f.root, "missing.sqlite"),
      }),
    ).rejects.toThrow();
    expect(existsSync(f.outputDirectory)).toBe(false);
  });

  it("does not disturb an active manager owner and removes its new empty output", async () => {
    const f = fixture();
    const owner = open(`${f.managerPath}.owner`);
    owner.exec("BEGIN EXCLUSIVE");
    await expect(createBackupPair(f)).rejects.toThrow();
    expect(existsSync(f.outputDirectory)).toBe(false);
    expect(f.manager.prepare("SELECT data FROM runs").get()).toEqual({
      data: f.run,
    });
  });

  it.each(["canonical", "symlink"] as const)(
    "blocks backup while a manager is open through its %s path",
    async (kind) => {
      const f = fixture();
      const alias = path.join(f.root, "manager-alias.sqlite");
      symlinkSync(f.managerPath, alias);
      const owner = new Store(kind === "symlink" ? alias : f.managerPath);
      try {
        await expect(createBackupPair(f)).rejects.toThrow();
        expect(existsSync(f.outputDirectory)).toBe(false);
      } finally {
        owner.close();
      }
    },
  );

  it("rejects hard-linked manager files for both store ownership and backup", async () => {
    const f = fixture();
    const alias = path.join(f.root, "manager-hardlink.sqlite");
    linkSync(f.managerPath, alias);
    for (const filename of [f.managerPath, alias]) {
      expect(() => {
        const owner = new Store(filename);
        owner.close();
      }).toThrow();
      await expect(
        createBackupPair({ ...f, managerPath: filename }),
      ).rejects.toThrow();
      expect(existsSync(f.outputDirectory)).toBe(false);
    }
  });

  it.each(["manager", "evidence"] as const)(
    "refuses an active %s writer and releases its own locks",
    async (kind) => {
      const f = fixture();
      const locked = kind === "manager" ? f.manager : f.evidence;
      locked.exec("BEGIN IMMEDIATE");
      await expect(createBackupPair(f)).rejects.toThrow();
      expect(existsSync(f.outputDirectory)).toBe(false);
      locked.exec("ROLLBACK");
      const manager = open(`${f.managerPath}.owner`);
      manager.exec("BEGIN EXCLUSIVE");
      manager.exec("ROLLBACK");
      const verifier = open(
        kind === "manager" ? f.managerPath : f.evidencePath,
      );
      verifier.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
      verifier.exec("ROLLBACK");
    },
  );

  it("cleans up only its new output when a source is not a valid SQLite database", async () => {
    const f = fixture();
    const invalid = path.join(f.root, "invalid.sqlite");
    writeFileSync(invalid, "not a database");
    const sentinel = path.join(f.root, "keep.txt");
    writeFileSync(sentinel, "untouched");
    await expect(
      createBackupPair({ ...f, evidencePath: invalid }),
    ).rejects.toThrow();
    expect(existsSync(f.outputDirectory)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("untouched");
  });
});
