/** Create complete, locally retained SQLite backups before producing an import snapshot. */
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { ManagerStore } from "./manager-store.ts";
import { createNodeSqlDriver } from "./sql-driver.ts";

export type BackupPairPaths = {
  managerBackup: string;
  evidenceBackup: string;
  stagedManager: string;
};
/**
 * Prevents writers during the copies and checks the canonical manager owner lock.
 * Managers running older code may use an alias lock, so both old services must be stopped.
 * The operator must keep both old services stopped
 * after this call; a database lock cannot keep a process stopped after it is released.
 */
export async function createBackupPair(input: {
  managerPath: string;
  evidencePath: string;
  outputDirectory: string;
}): Promise<BackupPairPaths> {
  const managerPath = realpathSync(input.managerPath);
  const evidencePath = realpathSync(input.evidencePath);
  if (
    path.resolve(input.managerPath) !== managerPath ||
    path.resolve(input.evidencePath) !== evidencePath
  )
    throw new Error("Use canonical database paths");
  const managerStat = statSync(managerPath);
  const evidenceStat = statSync(evidencePath);
  if (
    !managerStat.isFile() ||
    !evidenceStat.isFile() ||
    managerStat.nlink !== 1 ||
    evidenceStat.nlink !== 1 ||
    (managerStat.dev === evidenceStat.dev &&
      managerStat.ino === evidenceStat.ino)
  )
    throw new Error("Expected two distinct database files");
  const directory = path.resolve(input.outputDirectory);
  mkdirSync(directory, { mode: 0o700 }); // Fails if it already exists.
  const paths = {
    managerBackup: path.join(directory, "manager.original.sqlite"),
    evidenceBackup: path.join(directory, "evidence.original.sqlite"),
    stagedManager: path.join(directory, "manager.staged.sqlite"),
  };
  const writableConnections: DatabaseSync[] = [];
  const readonlyConnections: DatabaseSync[] = [];
  const locked: DatabaseSync[] = [];
  let success = false;
  try {
    const open = (filename: string, readOnly = false) => {
      const db = new DatabaseSync(filename, { readOnly });
      (readOnly ? readonlyConnections : writableConnections).push(db);
      return db;
    };
    const lock = (db: DatabaseSync, mode: "EXCLUSIVE" | "IMMEDIATE") => {
      db.exec(`PRAGMA busy_timeout=0; BEGIN ${mode}`);
      locked.push(db);
    };
    // Readers must exist before any writable source connection; this also preserves
    // stopped-process WALs when acquiring a later lock fails.
    const manager = open(managerPath, true);
    const evidence = open(evidencePath, true);
    const pinReader = (db: DatabaseSync) => {
      db.exec("BEGIN");
      db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
    };
    pinReader(manager);
    pinReader(evidence);
    const owner = open(`${managerPath}.owner`);
    lock(owner, "EXCLUSIVE");
    lock(open(managerPath), "IMMEDIATE");
    lock(open(evidencePath), "IMMEDIATE");
    // Refresh both read snapshots after writers have been stopped on both stores.
    manager.exec("ROLLBACK");
    evidence.exec("ROLLBACK");
    pinReader(manager);
    pinReader(evidence);
    for (const filename of Object.values(paths))
      closeSync(openSync(filename, "wx", 0o600));
    await backup(manager, paths.managerBackup);
    await backup(evidence, paths.evidenceBackup);
    await backup(manager, paths.stagedManager);
    for (const filename of Object.values(paths)) chmodSync(filename, 0o600);
    for (const filename of [paths.managerBackup, paths.evidenceBackup]) {
      const db = open(filename, true);
      const rows = db.prepare("PRAGMA integrity_check").all() as {
        integrity_check: string;
      }[];
      if (rows.length !== 1 || rows[0].integrity_check !== "ok")
        throw new Error("Backup integrity check failed");
    }
    const staged = open(paths.stagedManager);
    staged.exec("PRAGMA foreign_keys=ON");
    // Upgrade only the disposable copy. Do not rewrite interrupted runs or notes.
    new ManagerStore(createNodeSqlDriver(staged), { recoverOnStartup: false });
    success = true;
    return paths;
  } finally {
    for (const db of locked.reverse()) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* retain the original error */
      }
    }
    // Keep the source readers alive until writable lock connections have closed.
    // Otherwise SQLite may checkpoint and remove an old source WAL on close.
    for (const db of [
      ...writableConnections.reverse(),
      ...readonlyConnections.reverse(),
    ]) {
      try {
        db.close();
      } catch {
        /* retain the original error */
      }
    }
    if (!success) {
      for (const filename of Object.values(paths)) {
        for (const suffix of ["", "-wal", "-shm", "-journal"]) {
          try {
            unlinkSync(`${filename}${suffix}`);
          } catch {
            /* not created */
          }
        }
      }
      try {
        rmdirSync(directory);
      } catch {
        /* never remove unexpected files */
      }
    }
  }
}
