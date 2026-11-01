/** Manager-owned state, review history, runs and evaluation reports. */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DeliveryStore } from "./delivery-store.ts";
import type {
  EvaluationReport,
  Project,
  Run,
} from "../application/contracts.ts";

export class Store {
  private readonly db: DatabaseSync;
  private readonly ownerLock: DatabaseSync;
  readonly delivery: DeliveryStore;
  constructor(filename: string) {
    const absolute = path.resolve(filename);
    mkdirSync(path.dirname(absolute), { recursive: true });
    this.ownerLock = new DatabaseSync(`${absolute}.owner`);
    try {
      this.ownerLock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    } catch (error) {
      this.ownerLock.close();
      throw new Error("Manager database already has an owner", {
        cause: error,
      });
    }
    let opened: DatabaseSync | undefined;
    try {
      opened = new DatabaseSync(absolute);
      this.db = opened;
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
      );
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS manager_migrations(version INTEGER PRIMARY KEY);`);
        const version = this.db
          .prepare(
            "SELECT COALESCE(MAX(version), 0) AS version FROM manager_migrations",
          )
          .get() as { version: number };
        if (version.version > 2)
          throw new Error(
            "Manager database version is newer than this application",
          );
        if (version.version === 0)
          this.db.exec(`CREATE TABLE delivery_repositories(id TEXT PRIMARY KEY, identity TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL);
          CREATE TABLE delivery_outbox(id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES delivery_repositories(id), operation_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, attempt_id TEXT, lease_expires_at TEXT);
          INSERT INTO manager_migrations(version) VALUES (1);`);
        if (version.version < 2)
          this.db.exec(`CREATE TABLE IF NOT EXISTS delivery_work_items(repository_id TEXT NOT NULL REFERENCES delivery_repositories(id), issue_number INTEGER NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(repository_id, issue_number));
          CREATE TABLE IF NOT EXISTS delivery_jobs(id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES delivery_repositories(id), kind TEXT NOT NULL, status TEXT NOT NULL, attempt_id TEXT, lease_expires_at TEXT);
          INSERT INTO manager_migrations(version) VALUES (2);`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.delivery = new DeliveryStore(this.db);
      this.delivery.recoverExpired(new Date().toISOString());
      for (const run of this.runs()) {
        if (run.status !== "running") continue;
        run.status = "error";
        run.error = "Server restarted; retry the intake or question.";
        run.endedAt = new Date().toISOString();
        for (const span of run.spans)
          if (span.status === "running") {
            span.status = "failed";
            span.error = run.error;
            span.endedAt = run.endedAt;
          }
        this.saveRun(run);
      }
      for (const project of this.list()) {
        let changed = false;
        for (const note of project.notes) {
          if (["queued", "storing", "extracting"].includes(note.status)) {
            note.status = "error";
            note.error =
              "Intake interrupted; retry uses the same source/version.";
            changed = true;
          }
        }
        if (changed) this.save(project);
      }
    } catch (error) {
      opened?.close();
      this.ownerLock.exec("ROLLBACK");
      this.ownerLock.close();
      throw error;
    }
  }
  create(name: string): Project {
    const project: Project = {
      id: randomUUID(),
      name,
      revision: 0,
      createdAt: new Date().toISOString(),
      notes: [],
      candidates: [],
      approved: [],
      history: [],
      reviews: [],
      conversations: [],
    };
    this.save(project);
    return project;
  }
  list(): Project[] {
    return this.all<Project>("projects");
  }
  get(id: string): Project {
    return this.one<Project>("projects", id);
  }
  save(project: Project): void {
    this.write("projects", project);
  }
  runs(projectId?: string): Run[] {
    return this.all<Run>("runs").filter(
      (r) => !projectId || r.projectId === projectId,
    );
  }
  getRun(id: string): Run {
    return this.one<Run>("runs", id);
  }
  saveRun(run: Run): void {
    this.write("runs", run);
  }
  evaluations(): EvaluationReport[] {
    return this.all<EvaluationReport>("evaluations");
  }
  getEvaluation(id: string): EvaluationReport {
    return this.one<EvaluationReport>("evaluations", id);
  }
  saveEvaluation(report: EvaluationReport): void {
    this.write("evaluations", report);
  }
  /** Commits a state transition and its terminal run together. */
  commit(project: Project, run: Run): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.save(project);
      this.saveRun(run);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    this.db.close();
    this.ownerLock.exec("ROLLBACK");
    this.ownerLock.close();
  }
  private all<T>(table: "projects" | "runs" | "evaluations"): T[] {
    return (
      this.db
        .prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`)
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data) as T);
  }
  private one<T>(table: "projects" | "runs" | "evaluations", id: string): T {
    const row = this.db
      .prepare(`SELECT data FROM ${table} WHERE id=?`)
      .get(id) as { data: string } | undefined;
    if (!row)
      throw new Error(
        `Unknown ${table === "projects" ? "project" : table === "runs" ? "run" : "evaluation"}`,
      );
    return JSON.parse(row.data) as T;
  }
  private write(
    table: "projects" | "runs" | "evaluations",
    value: { id: string },
  ): void {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
  }
}
