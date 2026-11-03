import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceCoreStore } from "../../../ingest-classifier/src/evidence/core-store.ts";
import { nodeEvidenceDriver } from "../../../ingest-classifier/src/evidence/sql-driver.ts";
import { ManagerStore } from "./manager-store.ts";
import { createNodeSqlDriver } from "./sql-driver.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirectories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function backups(mismatch = false, active = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "manager-export-test-"));
  temporaryDirectories.push(dir);
  const managerPath = path.join(dir, "manager.sqlite");
  const evidencePath = path.join(dir, "evidence.sqlite");
  const destination = path.join(dir, "snapshot.json");
  const evidenceDb = new DatabaseSync(evidencePath);
  const evidence = new EvidenceCoreStore(nodeEvidenceDriver(evidenceDb));
  const source = evidence.register({
    projectId: "project-one",
    sourceId: "note",
    sourceVersion: "1",
    idempotencyKey: "retry-key",
    markdown: "Fixture 😀",
    sourceDate: "2026-11-02",
  });
  evidence.ensureChunks(source);
  evidenceDb.close();
  const managerDb = new DatabaseSync(managerPath);
  new ManagerStore(createNodeSqlDriver(managerDb));
  const note = {
    ...source,
    status: active ? "storing" : "review",
    checksum: mismatch ? "incorrect" : source.checksum,
  };
  managerDb
    .prepare("INSERT INTO projects (id, data) VALUES (?, ?)")
    .run("project-one", JSON.stringify({ id: "project-one", notes: [note] }));
  managerDb.close();
  return { managerPath, evidencePath, destination };
}

function runExport(paths: ReturnType<typeof backups>) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./snapshot-export.ts", import.meta.url)),
      paths.managerPath,
      paths.evidencePath,
      paths.destination,
    ],
    { encoding: "utf8" },
  );
}

describe("offline snapshot export", () => {
  it("exports matching backup files privately and refuses to overwrite an existing export", () => {
    const paths = backups();
    const result = runExport(paths);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Snapshot pair saved");
    expect(statSync(paths.destination).mode & 0o777).toBe(0o600);
    const original = readFileSync(paths.destination, "utf8");
    const pair = JSON.parse(original);
    expect(pair.manager.kind).toBe("manager");
    expect(pair.evidence.kind).toBe("evidence");
    expect(pair.manager.tables[0].rows).toHaveLength(1);
    expect(pair.evidence.tables[0].rows).toHaveLength(1);
    const repeat = runExport(paths);
    expect(repeat.status).not.toBe(0);
    expect(readFileSync(paths.destination, "utf8")).toBe(original);
  });

  it("rejects inconsistent backup pairs without creating output", () => {
    const paths = backups(true);
    const result = runExport(paths);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Project note and evidence do not match");
    expect(existsSync(paths.destination)).toBe(false);
  });
  it("rejects a pair with active note intake without creating output", () => {
    const paths = backups(false, true);
    const result = runExport(paths);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Migration requires stopped note intake");
    expect(existsSync(paths.destination)).toBe(false);
  });
});
