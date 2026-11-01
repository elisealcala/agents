/** Durable local delivery state. External dispatch is deliberately not enabled. */
import type { DatabaseSync } from "node:sqlite";
import { reduceRepositoryState } from "../delivery/reducer.ts";
import {
  repositoryIdentitySchema,
  workItemSchema,
  type RepositoryIdentity,
} from "../delivery/contracts.ts";

type Repository = {
  identity: RepositoryIdentity;
  revision: number;
  status: string;
};
type Intent = { id: string; operationKey: string; kind: string };
type OutboxRow = {
  id: string;
  repository_id: string;
  operation_key: string;
  kind: string;
  revision: number;
  status: string;
  attempt_id: string | null;
  lease_expires_at: string | null;
};

export class DeliveryStore {
  constructor(private readonly db: DatabaseSync) {}

  registerRepository(input: RepositoryIdentity): Repository {
    const identity = repositoryIdentitySchema.parse(input);
    this.db
      .prepare(
        "INSERT INTO delivery_repositories(id, identity, revision, status) VALUES (?, ?, 0, 'ready')",
      )
      .run(identity.repositoryId, JSON.stringify(identity));
    return this.getRepository(identity.repositoryId);
  }
  getRepository(id: string): Repository {
    const row = this.db
      .prepare(
        "SELECT identity, revision, status FROM delivery_repositories WHERE id = ?",
      )
      .get(id) as
      | { identity: string; revision: number; status: string }
      | undefined;
    if (!row) throw new Error("Unknown repository");
    return {
      identity: repositoryIdentitySchema.parse(JSON.parse(row.identity)),
      revision: row.revision,
      status: row.status,
    };
  }
  listRepositories(): Repository[] {
    const rows = this.db
      .prepare("SELECT id FROM delivery_repositories ORDER BY id")
      .all() as { id: string }[];
    return rows.map((row) => this.getRepository(row.id));
  }
  listOutbox(repositoryId: string): OutboxRow[] {
    this.getRepository(repositoryId);
    return this.db
      .prepare(
        "SELECT * FROM delivery_outbox WHERE repository_id = ? ORDER BY rowid",
      )
      .all(repositoryId) as OutboxRow[];
  }
  transition(
    repositoryId: string,
    expectedRevision: number,
    nextStatus: string,
    intent: Intent,
  ): Repository {
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      !nextStatus.trim() ||
      !intent.id.trim() ||
      !intent.operationKey.trim() ||
      !intent.kind.trim()
    )
      throw new Error("Invalid transition");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getRepository(repositoryId);
      if (current.revision !== expectedRevision)
        throw new Error("Revision conflict");
      reduceRepositoryState(current.status, nextStatus);
      const changed = this.db
        .prepare(
          "UPDATE delivery_repositories SET revision = revision + 1, status = ? WHERE id = ? AND revision = ?",
        )
        .run(nextStatus, repositoryId, expectedRevision);
      if (changed.changes !== 1)
        throw new Error("Unknown repository or revision conflict");
      this.db
        .prepare(
          "INSERT INTO delivery_outbox(id, repository_id, operation_key, kind, revision, status) VALUES (?, ?, ?, ?, ?, 'queued')",
        )
        .run(
          intent.id,
          repositoryId,
          intent.operationKey,
          intent.kind,
          expectedRevision + 1,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getRepository(repositoryId);
  }
  claimOutbox(
    id: string,
    attemptId: string,
    now: string,
    expires: string,
  ): void {
    if (
      !attemptId.trim() ||
      !validTime(now) ||
      !validTime(expires) ||
      Date.parse(expires) <= Date.parse(now)
    )
      throw new Error("Invalid lease");
    // Expired dispatched work may have reached the provider; it must be reconciled first.
    const changed = this.db
      .prepare(
        "UPDATE delivery_outbox SET status='dispatching', attempt_id=?, lease_expires_at=? WHERE id=? AND status='queued' AND EXISTS (SELECT 1 FROM delivery_repositories r WHERE r.id=delivery_outbox.repository_id AND r.status != 'paused' AND r.revision=delivery_outbox.revision)",
      )
      .run(attemptId, expires, id);
    if (changed.changes !== 1) throw new Error("Intent is not queued");
  }
  finishOutbox(
    id: string,
    attemptId: string,
    now: string,
    outcome: "confirmed" | "unknown",
  ): void {
    if (!validTime(now) || !["confirmed", "unknown"].includes(outcome))
      throw new Error("Invalid outcome");
    const row = this.db
      .prepare(
        "SELECT status, attempt_id, lease_expires_at FROM delivery_outbox WHERE id=?",
      )
      .get(id) as
      | Pick<OutboxRow, "status" | "attempt_id" | "lease_expires_at">
      | undefined;
    if (
      row?.status !== "dispatching" ||
      row.attempt_id !== attemptId ||
      !row.lease_expires_at ||
      Date.parse(row.lease_expires_at) <= Date.parse(now)
    )
      throw new Error("Stale or expired attempt");
    this.db
      .prepare(
        "UPDATE delivery_outbox SET status=?, attempt_id=NULL, lease_expires_at=NULL WHERE id=?",
      )
      .run(outcome, id);
  }
  reconcileOutbox(id: string, outcome: "confirmed" | "failed"): void {
    if (!["confirmed", "failed"].includes(outcome))
      throw new Error("Invalid reconciliation");
    const changed = this.db
      .prepare(
        "UPDATE delivery_outbox SET status=?, attempt_id=NULL, lease_expires_at=NULL WHERE id=? AND status='unknown'",
      )
      .run(outcome, id);
    if (changed.changes !== 1)
      throw new Error("Intent does not require reconciliation");
  }
  saveObservedWork(input: unknown, expectedRevision: number | null): void {
    const work = workItemSchema.parse(input);
    if (work.provenance.kind !== "github_observation")
      throw new Error("Only observed GitHub work can be imported");
    if (work.status === "done")
      throw new Error("Observed closure alone cannot establish delivery");
    const repository = this.getRepository(
      work.identity.repository.repositoryId,
    );
    if (repository.identity.provider !== work.identity.repository.provider)
      throw new Error("Repository provider mismatch");
    const current = this.db
      .prepare(
        "SELECT revision FROM delivery_work_items WHERE repository_id=? AND issue_number=?",
      )
      .get(repository.identity.repositoryId, work.identity.issueNumber) as
      | { revision: number }
      | undefined;
    if (
      (current?.revision ?? null) !== expectedRevision ||
      work.revision !== (expectedRevision ?? -1) + 1
    )
      throw new Error("Work revision conflict");
    if (current)
      this.db
        .prepare(
          "UPDATE delivery_work_items SET revision=?, data=? WHERE repository_id=? AND issue_number=? AND revision=?",
        )
        .run(
          work.revision,
          JSON.stringify(work),
          repository.identity.repositoryId,
          work.identity.issueNumber,
          expectedRevision,
        );
    else
      this.db
        .prepare(
          "INSERT INTO delivery_work_items(repository_id, issue_number, revision, data) VALUES (?, ?, ?, ?)",
        )
        .run(
          repository.identity.repositoryId,
          work.identity.issueNumber,
          work.revision,
          JSON.stringify(work),
        );
  }
  listWork(repositoryId: string) {
    this.getRepository(repositoryId);
    const rows = this.db
      .prepare(
        "SELECT data FROM delivery_work_items WHERE repository_id=? ORDER BY issue_number",
      )
      .all(repositoryId) as { data: string }[];
    return rows.map((row) => workItemSchema.parse(JSON.parse(row.data)));
  }
  queuedJobs() {
    return this.db
      .prepare(
        "SELECT j.* FROM delivery_jobs j JOIN delivery_repositories r ON r.id=j.repository_id WHERE j.status='queued' AND r.status != 'paused' ORDER BY j.rowid",
      )
      .all() as { id: string; repository_id: string; kind: string }[];
  }
  queuedOutbox() {
    return this.db
      .prepare(
        "SELECT o.* FROM delivery_outbox o JOIN delivery_repositories r ON r.id=o.repository_id WHERE o.status='queued' AND r.status != 'paused' AND r.revision=o.revision ORDER BY o.rowid",
      )
      .all() as OutboxRow[];
  }
  enqueueJob(id: string, repositoryId: string, kind: string): void {
    if (!id.trim() || !kind.trim()) throw new Error("Invalid job");
    this.getRepository(repositoryId);
    this.db
      .prepare(
        "INSERT INTO delivery_jobs(id, repository_id, kind, status) VALUES (?, ?, ?, 'queued')",
      )
      .run(id, repositoryId, kind);
  }
  listJobs(repositoryId: string) {
    this.getRepository(repositoryId);
    return this.db
      .prepare(
        "SELECT * FROM delivery_jobs WHERE repository_id=? ORDER BY rowid",
      )
      .all(repositoryId) as {
      id: string;
      repository_id: string;
      kind: string;
      status: string;
      attempt_id: string | null;
      lease_expires_at: string | null;
    }[];
  }
  claimJob(id: string, attemptId: string, now: string, expires: string): void {
    if (
      !attemptId.trim() ||
      !validTime(now) ||
      !validTime(expires) ||
      Date.parse(expires) <= Date.parse(now)
    )
      throw new Error("Invalid lease");
    const changed = this.db
      .prepare(
        "UPDATE delivery_jobs SET status='running', attempt_id=?, lease_expires_at=? WHERE id=? AND status='queued' AND EXISTS (SELECT 1 FROM delivery_repositories r WHERE r.id=delivery_jobs.repository_id AND r.status != 'paused')",
      )
      .run(attemptId, expires, id);
    if (changed.changes !== 1) throw new Error("Job is not queued");
  }
  finishJob(
    id: string,
    attemptId: string,
    now: string,
    outcome: "completed" | "reconciling",
  ): void {
    if (!validTime(now) || !["completed", "reconciling"].includes(outcome))
      throw new Error("Invalid outcome");
    const row = this.db
      .prepare(
        "SELECT status, attempt_id, lease_expires_at FROM delivery_jobs WHERE id=?",
      )
      .get(id) as
      | {
          status: string;
          attempt_id: string | null;
          lease_expires_at: string | null;
        }
      | undefined;
    if (
      row?.status !== "running" ||
      row.attempt_id !== attemptId ||
      !row.lease_expires_at ||
      Date.parse(row.lease_expires_at) <= Date.parse(now)
    )
      throw new Error("Stale or expired attempt");
    this.db
      .prepare(
        "UPDATE delivery_jobs SET status=?, attempt_id=NULL, lease_expires_at=NULL WHERE id=?",
      )
      .run(outcome, id);
  }
  recoverExpired(now: string): number {
    if (!validTime(now)) throw new Error("Invalid time");
    // ISO timestamps validated at entry and compared as instants, not strings.
    const rows = this.db
      .prepare(
        "SELECT id, lease_expires_at FROM delivery_outbox WHERE status='dispatching'",
      )
      .all() as { id: string; lease_expires_at: string }[];
    let recovered = 0;
    for (const row of rows)
      if (Date.parse(row.lease_expires_at) <= Date.parse(now)) {
        recovered += Number(
          this.db
            .prepare(
              "UPDATE delivery_outbox SET status='unknown', attempt_id=NULL, lease_expires_at=NULL WHERE id=? AND status='dispatching'",
            )
            .run(row.id).changes,
        );
      }
    const jobs = this.db
      .prepare(
        "SELECT id, lease_expires_at FROM delivery_jobs WHERE status='running'",
      )
      .all() as { id: string; lease_expires_at: string }[];
    for (const job of jobs)
      if (Date.parse(job.lease_expires_at) <= Date.parse(now)) {
        recovered += Number(
          this.db
            .prepare(
              "UPDATE delivery_jobs SET status='reconciling', attempt_id=NULL, lease_expires_at=NULL WHERE id=? AND status='running'",
            )
            .run(job.id).changes,
        );
      }
    return recovered;
  }
}
function validTime(value: string): boolean {
  return (
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
