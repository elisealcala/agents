import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Candidate, Note, Run } from "../application/contracts.ts";
import { DurableManagerStore } from "./durable-manager-store.ts";
import type { DurableSqlStorage } from "./sql-driver.ts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

/** SQLite-backed test double; the separate local Workers fixture tests the real runtime. */
function setup() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const storage: DurableSqlStorage = {
    sql: {
      exec(query, ...values) {
        if (/^\s*SELECT\b/i.test(query)) {
          const rows = database.prepare(query).all(...values);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        if (values.length === 0) {
          database.exec(query);
          return { toArray: () => [], rowsWritten: 0 };
        }
        const result = database.prepare(query).run(...values);
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
  return { database, storage, store: new DurableManagerStore(storage) };
}

function makeRun(projectId: string, status: Run["status"] = "success"): Run {
  return {
    id: randomUUID(),
    projectId,
    action: "intake",
    status,
    input: { sourceId: "meeting" },
    output: null,
    error: null,
    startedAt: "2026-11-01T00:00:00.000Z",
    endedAt: status === "running" ? null : "2026-11-01T00:01:00.000Z",
    spans:
      status === "running"
        ? [
            {
              id: randomUUID(),
              parentId: null,
              name: "registration",
              kind: "tool",
              status: "running",
              input: null,
              output: null,
              error: null,
              startedAt: "2026-11-01T00:00:00.000Z",
              endedAt: null,
            },
          ]
        : [],
  };
}

function makeCandidate(projectId: string, noteId: string): Candidate {
  return {
    id: randomUUID(),
    noteId,
    entity: "Release",
    field: "owner",
    value: "Ada",
    effectiveDate: null,
    evidence: {
      kind: "document",
      projectId,
      documentRef: "fixture-source",
      checksum: "fixture-hash",
      sourceVersion: "1",
      start: 0,
      end: 3,
      quote: "Ada",
    },
    status: "pending",
    conflict: false,
    historical: false,
    createdAt: "2026-11-01T00:00:00.000Z",
  };
}

function makeNote(runId: string, status: Note["status"]): Note {
  return {
    id: randomUUID(),
    sourceId: "meeting",
    sourceVersion: "1",
    markdown: "Ada",
    sourceDate: null,
    checksum: "fixture-hash",
    documentRef: "fixture-source",
    status,
    indexStatus: "ready",
    runId,
    error: null,
  };
}

describe("durable manager store", () => {
  it("persists project state, pending candidate evidence, and a terminal run through reopening", () => {
    const { storage, store } = setup();
    const project = store.create("Atlas");
    const run = makeRun(project.id);
    const note = makeNote(run.id, "review");
    project.notes.push(note);
    project.candidates.push(makeCandidate(project.id, note.id));
    store.commit(project, run);
    store.close();
    const reopened = new DurableManagerStore(storage);
    expect(reopened.list()).toEqual([project]);
    expect(reopened.get(project.id)).toEqual(project);
    expect(reopened.runs(project.id)).toEqual([run]);
    expect(reopened.get(project.id).candidates[0].evidence).toEqual(
      project.candidates[0].evidence,
    );
    expect(reopened.get(project.id).notes[0].markdown).toBe("Ada");
  });

  it("recovers interrupted legacy runs without changing original evidence", () => {
    const { storage, store } = setup();
    const project = store.create("Atlas");
    const run = makeRun(project.id, "running");
    const note = makeNote(run.id, "storing");
    project.notes.push(note);
    project.candidates.push(makeCandidate(project.id, note.id));
    store.commit(project, run);
    const reopened = new DurableManagerStore(storage);
    expect(reopened.getRun(run.id)).toMatchObject({
      status: "error",
      error: expect.stringContaining("restarted"),
      spans: [expect.objectContaining({ status: "failed" })],
    });
    expect(reopened.get(project.id).notes[0]).toMatchObject({
      status: "error",
      markdown: "Ada",
      checksum: "fixture-hash",
      documentRef: "fixture-source",
    });
    expect(reopened.get(project.id).candidates[0]).toEqual(
      project.candidates[0],
    );
  });

  it("persists delivery state and atomically rejects a conflicting outbox intent", () => {
    const { storage, store } = setup();
    const repo = {
      provider: "github" as const,
      repositoryId: "repo-1",
      owner: "example",
      name: "project",
    };
    store.delivery.registerRepository(repo);
    store.delivery.transition(repo.repositoryId, 0, "in_progress", {
      id: "one",
      operationKey: "key",
      kind: "fixture",
    });
    expect(() =>
      store.delivery.transition(repo.repositoryId, 1, "ready", {
        id: "two",
        operationKey: "key",
        kind: "fixture",
      }),
    ).toThrow();
    const reopened = new DurableManagerStore(storage);
    expect(reopened.delivery.getRepository(repo.repositoryId)).toMatchObject({
      identity: repo,
      revision: 1,
      status: "in_progress",
    });
    expect(reopened.delivery.listOutbox(repo.repositoryId)).toEqual([
      expect.objectContaining({ id: "one", status: "queued", revision: 1 }),
    ]);
  });

  it("rolls back a project update if persisting its run fails", () => {
    const { database, store } = setup();
    const project = store.create("Original");
    const run = makeRun(project.id);
    database.exec(
      "CREATE TRIGGER reject_run BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;",
    );
    project.name = "Should roll back";
    expect(() => store.commit(project, run)).toThrow("fixture failure");
    expect(store.get(project.id).name).toBe("Original");
    expect(() => store.getRun(run.id)).toThrow("Unknown run");
  });
});
