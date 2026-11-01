import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../application/contracts.ts";
import { runJob } from "../delivery/jobs.ts";
import { runOutbox } from "../delivery/outbox.ts";
import { Store } from "./store.ts";

const roots: string[] = [];
const stores: Store[] = [];
const repository = {
  provider: "github" as const,
  repositoryId: "repo-1",
  owner: "example",
  name: "one",
};
const other = { ...repository, repositoryId: "repo-2", name: "two" };
const intent = { id: "intent-1", operationKey: "operation-1", kind: "sync" };
const now = "2026-11-01T12:00:00.000Z";
const expired = "2026-11-01T12:01:00.000Z";
const later = "2026-11-01T12:02:00.000Z";

async function filename() {
  const root = await mkdtemp(path.join(os.tmpdir(), "delivery-store-test-"));
  roots.push(root);
  return path.join(root, "manager.sqlite");
}
function open(pathname: string) {
  const store = new Store(pathname);
  stores.push(store);
  return store;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // A restart test may already have closed this instance.
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("durable delivery state", () => {
  it("migrates legacy projects and pending reviews without changing their evidence", async () => {
    const pathname = await filename();
    const db = new DatabaseSync(pathname);
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL)");
    const project: Project = {
      id: "p1",
      name: "Atlas",
      revision: 3,
      createdAt: now,
      notes: [],
      candidates: [
        {
          id: "candidate-1",
          noteId: "note-1",
          entity: "Task",
          field: "status",
          value: "open",
          effectiveDate: null,
          evidence: {
            kind: "document",
            projectId: "p1",
            documentRef: "doc-1",
            checksum: "hash",
            sourceVersion: "1",
            start: 0,
            end: 4,
            quote: "open",
          },
          status: "pending",
          conflict: false,
          historical: false,
          createdAt: now,
        },
      ],
      approved: [],
      history: [],
      reviews: [],
      conversations: [],
    };
    db.prepare("INSERT INTO projects(id,data) VALUES (?,?)").run(
      project.id,
      JSON.stringify(project),
    );
    db.close();
    const store = open(pathname);
    expect(store.get(project.id)).toEqual(project);
    expect(store.delivery.listRepositories()).toEqual([]);
    store.close();
    expect(open(pathname).get(project.id)).toEqual(project);
  });

  it("commits repository state and intent together and rejects conflicts without touching another repository", async () => {
    const store = open(await filename());
    const delivery = store.delivery;
    expect(delivery.registerRepository(repository)).toMatchObject({
      identity: repository,
      revision: 0,
      status: "ready",
    });
    delivery.registerRepository(other);
    expect(
      delivery.transition(repository.repositoryId, 0, "in_progress", intent),
    ).toMatchObject({ revision: 1, status: "in_progress" });
    expect(delivery.listOutbox(repository.repositoryId)).toEqual([
      expect.objectContaining({
        id: intent.id,
        repository_id: repository.repositoryId,
        status: "queued",
        revision: 1,
      }),
    ]);
    expect(() =>
      delivery.transition(repository.repositoryId, 0, "done", {
        ...intent,
        id: "another",
        operationKey: "another",
      }),
    ).toThrow();
    expect(() =>
      delivery.transition("missing", 0, "done", {
        ...intent,
        id: "another",
        operationKey: "another",
      }),
    ).toThrow();
    expect(() =>
      delivery.transition(repository.repositoryId, 1, "done", {
        ...intent,
        id: "another",
      }),
    ).toThrow();
    expect(delivery.getRepository(repository.repositoryId)).toMatchObject({
      revision: 1,
      status: "in_progress",
    });
    expect(delivery.getRepository(other.repositoryId)).toMatchObject({
      revision: 0,
      status: "ready",
    });
    expect(delivery.listOutbox(other.repositoryId)).toEqual([]);
    expect(() => delivery.listOutbox("missing")).toThrow();
  });

  it("fences expired attempts and requires reconciliation for an unknown effect after restart", async () => {
    const pathname = await filename();
    const first = open(pathname);
    first.delivery.registerRepository(repository);
    first.delivery.transition(
      repository.repositoryId,
      0,
      "in_progress",
      intent,
    );
    first.delivery.claimOutbox(intent.id, "attempt-1", now, expired);
    expect(() =>
      first.delivery.finishOutbox(intent.id, "wrong", now, "confirmed"),
    ).toThrow();
    expect(() =>
      first.delivery.finishOutbox(intent.id, "attempt-1", expired, "confirmed"),
    ).toThrow();
    first.close();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(later));
    const delivery = open(pathname).delivery;
    expect(delivery.recoverExpired(later)).toBe(0);
    expect(delivery.listOutbox(repository.repositoryId)[0]).toMatchObject({
      status: "unknown",
    });
    expect(() =>
      delivery.claimOutbox(
        intent.id,
        "attempt-2",
        later,
        "2026-11-01T12:03:00.000Z",
      ),
    ).toThrow();
    expect(() =>
      delivery.finishOutbox(intent.id, "attempt-1", later, "confirmed"),
    ).toThrow();
    delivery.reconcileOutbox(intent.id, "confirmed");
    expect(delivery.listOutbox(repository.repositoryId)[0]).toMatchObject({
      status: "confirmed",
    });
    expect(() => delivery.reconcileOutbox(intent.id, "failed")).toThrow();
  });

  it("allows a current attempt to confirm and prevents a second live database owner", async () => {
    const pathname = await filename();
    const store = open(pathname);
    expect(() => new Store(pathname)).toThrow();
    store.delivery.registerRepository(repository);
    store.delivery.transition(
      repository.repositoryId,
      0,
      "in_progress",
      intent,
    );
    expect(() =>
      store.delivery.claimOutbox(intent.id, "", now, expired),
    ).toThrow();
    expect(() =>
      store.delivery.claimOutbox(intent.id, "a", expired, now),
    ).toThrow();
    store.delivery.claimOutbox(intent.id, "a", now, expired);
    store.delivery.finishOutbox(intent.id, "a", now, "confirmed");
    expect(store.delivery.listOutbox(repository.repositoryId)[0]).toMatchObject(
      { status: "confirmed", attempt_id: null },
    );
    store.close();
    expect(
      open(pathname).delivery.getRepository(repository.repositoryId).revision,
    ).toBe(1);
  });

  it("rejects future database versions and releases its owner lock after initialization fails", async () => {
    const pathname = await filename();
    const db = new DatabaseSync(pathname);
    db.exec(
      "CREATE TABLE manager_migrations(version INTEGER PRIMARY KEY); INSERT INTO manager_migrations VALUES (3)",
    );
    db.close();
    expect(() => new Store(pathname)).toThrow("newer than this application");
    // A failed initialization must not keep the database's ownership lock.
    const owner = new DatabaseSync(`${pathname}.owner`);
    expect(() =>
      owner.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK"),
    ).not.toThrow();
    owner.close();
    const repair = new DatabaseSync(pathname);
    repair.exec("DELETE FROM manager_migrations WHERE version=3");
    repair.close();
    expect(open(pathname).delivery.listRepositories()).toEqual([]);
  });

  it("fences job attempts and recovers expired running jobs to reconciliation on restart", async () => {
    const pathname = await filename();
    const first = open(pathname);
    first.delivery.registerRepository(repository);
    first.delivery.enqueueJob("job-1", repository.repositoryId, "scan");
    first.delivery.claimJob("job-1", "attempt-1", now, expired);
    expect(() =>
      first.delivery.finishJob("job-1", "wrong", now, "completed"),
    ).toThrow();
    expect(() =>
      first.delivery.finishJob("job-1", "attempt-1", expired, "completed"),
    ).toThrow();
    first.close();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(later));
    const delivery = open(pathname).delivery;
    expect(delivery.listJobs(repository.repositoryId)).toEqual([
      expect.objectContaining({
        id: "job-1",
        status: "reconciling",
        attempt_id: null,
      }),
    ]);
    expect(() =>
      delivery.claimJob(
        "job-1",
        "attempt-2",
        later,
        "2026-11-01T12:03:00.000Z",
      ),
    ).toThrow();
    expect(() =>
      delivery.finishJob("job-1", "attempt-1", later, "completed"),
    ).toThrow();
    delivery.enqueueJob("job-2", repository.repositoryId, "scan");
    delivery.claimJob("job-2", "attempt-2", later, "2026-11-01T12:03:00.000Z");
    delivery.finishJob("job-2", "attempt-2", later, "completed");
    expect(delivery.listJobs(repository.repositoryId)[1]).toMatchObject({
      status: "completed",
      attempt_id: null,
    });
  });

  it("executes a claimed job once, reconciling failures and fencing expired results", async () => {
    const delivery = open(await filename()).delivery;
    delivery.registerRepository(repository);
    delivery.enqueueJob("success", repository.repositoryId, "scan");
    const adapter = vi.fn(async () => {});
    const lease = { jobId: "success", attemptId: "a", now, expires: expired };
    await runJob(delivery, lease, adapter, () => now);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(delivery.listJobs(repository.repositoryId)[0]).toMatchObject({
      status: "completed",
    });
    await expect(runJob(delivery, lease, adapter, () => now)).rejects.toThrow();
    expect(adapter).toHaveBeenCalledTimes(1);

    delivery.enqueueJob("failure", repository.repositoryId, "scan");
    const failure = vi.fn(async () => {
      throw new Error("outcome unknown");
    });
    await expect(
      runJob(delivery, { ...lease, jobId: "failure" }, failure, () => now),
    ).rejects.toThrow("outcome unknown");
    expect(failure).toHaveBeenCalledTimes(1);
    expect(delivery.listJobs(repository.repositoryId)[1]).toMatchObject({
      status: "reconciling",
    });

    delivery.enqueueJob("expired", repository.repositoryId, "scan");
    await expect(
      runJob(delivery, { ...lease, jobId: "expired" }, adapter, () => expired),
    ).rejects.toThrow("expired attempt");
    expect(delivery.listJobs(repository.repositoryId)[2]).toMatchObject({
      status: "running",
    });
    delivery.recoverExpired(expired);
    expect(delivery.listJobs(repository.repositoryId)[2]).toMatchObject({
      status: "reconciling",
    });
  });

  it("persists separately scoped observed work with revision guards and never treats observation alone as delivery", async () => {
    const pathname = await filename();
    const first = open(pathname);
    const delivery = first.delivery;
    delivery.registerRepository(repository);
    delivery.registerRepository(other);
    const observed = {
      identity: { repository, issueNumber: 21 },
      revision: 0,
      status: "in_progress",
      provenance: {
        kind: "github_observation",
        sourceUrl: "https://github.com/example/one/issues/21",
        observedAt: now,
      },
    };
    const otherWork = {
      ...observed,
      identity: { repository: other, issueNumber: 21 },
    };
    delivery.saveObservedWork(observed, null);
    delivery.saveObservedWork(otherWork, null);
    expect(delivery.listWork(repository.repositoryId)).toEqual([observed]);
    expect(delivery.listWork(other.repositoryId)).toEqual([otherWork]);
    expect(() => delivery.saveObservedWork(observed, null)).toThrow();
    expect(() =>
      delivery.saveObservedWork(
        { ...observed, revision: 1, status: "done" },
        0,
      ),
    ).toThrow();
    expect(() =>
      delivery.saveObservedWork(
        {
          ...observed,
          revision: 1,
          provenance: { kind: "planner_proposal", proposalId: "proposal" },
        },
        0,
      ),
    ).toThrow();
    expect(() =>
      delivery.saveObservedWork(
        {
          ...observed,
          revision: 1,
          identity: {
            repository: { ...repository, repositoryId: "missing" },
            issueNumber: 21,
          },
        },
        0,
      ),
    ).toThrow();
    const updated = { ...observed, revision: 1, status: "closed_unverified" };
    delivery.saveObservedWork(updated, 0);
    expect(() =>
      delivery.saveObservedWork({ ...updated, revision: 2 }, 0),
    ).toThrow();
    first.close();
    const reopened = open(pathname).delivery;
    expect(reopened.listWork(repository.repositoryId)).toEqual([updated]);
    expect(reopened.listWork(other.repositoryId)).toEqual([otherWork]);
    expect(() => reopened.listWork("missing")).toThrow();
  });

  it("upgrades a version-one database without losing delivery records", async () => {
    const pathname = await filename();
    const db = new DatabaseSync(pathname);
    db.exec(`CREATE TABLE manager_migrations(version INTEGER PRIMARY KEY);
      INSERT INTO manager_migrations VALUES (1);
      CREATE TABLE delivery_repositories(id TEXT PRIMARY KEY, identity TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE delivery_outbox(id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES delivery_repositories(id), operation_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, attempt_id TEXT, lease_expires_at TEXT);`);
    db.prepare(
      "INSERT INTO delivery_repositories VALUES (?, ?, 1, 'in_progress')",
    ).run(repository.repositoryId, JSON.stringify(repository));
    db.prepare(
      "INSERT INTO delivery_outbox(id, repository_id, operation_key, kind, revision, status) VALUES (?, ?, ?, ?, 1, 'queued')",
    ).run(intent.id, repository.repositoryId, intent.operationKey, intent.kind);
    db.close();
    const store = open(pathname);
    expect(store.delivery.getRepository(repository.repositoryId)).toMatchObject(
      { identity: repository, revision: 1, status: "in_progress" },
    );
    expect(store.delivery.listOutbox(repository.repositoryId)).toEqual([
      expect.objectContaining({ id: intent.id, status: "queued" }),
    ]);
    const work = {
      identity: { repository, issueNumber: 21 },
      revision: 0,
      status: "ready",
      provenance: {
        kind: "github_observation",
        sourceUrl: "https://github.com/example/one/issues/21",
        observedAt: now,
      },
    };
    store.delivery.saveObservedWork(work, null);
    store.delivery.enqueueJob("job-1", repository.repositoryId, "scan");
    expect(store.delivery.listWork(repository.repositoryId)).toEqual([work]);
    expect(store.delivery.listJobs(repository.repositoryId)).toEqual([
      expect.objectContaining({ id: "job-1", status: "queued" }),
    ]);
    store.close();
    const reopened = open(pathname).delivery;
    expect(reopened.listWork(repository.repositoryId)).toEqual([work]);
    expect(reopened.listJobs(repository.repositoryId)).toHaveLength(1);
    expect(reopened.listOutbox(repository.repositoryId)).toHaveLength(1);
  });

  it("dispatches a claimed outbox intent once and preserves unknown outcomes", async () => {
    const delivery = open(await filename()).delivery;
    delivery.registerRepository(repository);
    delivery.transition(repository.repositoryId, 0, "in_progress", intent);
    const adapter = vi.fn(async () => {});
    const lease = {
      intentId: intent.id,
      attemptId: "a",
      now,
      expires: expired,
    };
    await runOutbox(delivery, lease, adapter, () => now);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(delivery.listOutbox(repository.repositoryId)[0]).toMatchObject({
      status: "confirmed",
    });
    await expect(
      runOutbox(delivery, lease, adapter, () => now),
    ).rejects.toThrow();
    expect(adapter).toHaveBeenCalledTimes(1);
    delivery.transition(repository.repositoryId, 1, "ready", {
      id: "failed",
      operationKey: "failed",
      kind: "sync",
    });
    const failure = vi.fn(async () => {
      throw new Error("unknown outcome");
    });
    await expect(
      runOutbox(delivery, { ...lease, intentId: "failed" }, failure, () => now),
    ).rejects.toThrow("unknown outcome");
    expect(failure).toHaveBeenCalledTimes(1);
    expect(delivery.listOutbox(repository.repositoryId)[1]).toMatchObject({
      status: "unknown",
    });
    delivery.transition(repository.repositoryId, 2, "in_progress", {
      id: "expired",
      operationKey: "expired",
      kind: "sync",
    });
    await expect(
      runOutbox(
        delivery,
        { ...lease, intentId: "expired" },
        adapter,
        () => expired,
      ),
    ).rejects.toThrow("expired attempt");
    expect(delivery.listOutbox(repository.repositoryId)[2]).toMatchObject({
      status: "dispatching",
    });
    delivery.recoverExpired(expired);
    expect(delivery.listOutbox(repository.repositoryId)[2]).toMatchObject({
      status: "unknown",
    });
  });
});
