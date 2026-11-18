import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "../domain/projects.ts";
import { createNodeSqlDriver } from "../storage/sql-driver.ts";
import { SqlProjectsRepository } from "./projects.ts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

/** Seed the previous table/JSON format independently of the new schema module. */
function context() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);",
  );
  return {
    database,
    repository: new SqlProjectsRepository(createNodeSqlDriver(database)),
  };
}

function legacyProject(id = "legacy-project"): Project {
  const evidence = {
    kind: "document" as const,
    projectId: id,
    documentRef: "source:1",
    checksum: "immutable-checksum",
    sourceVersion: "1",
    start: 0,
    end: 3,
    quote: "Ada",
  };
  const candidate: Project["candidates"][number] = {
    id: "candidate-1",
    noteId: "note-1",
    entity: "Release",
    field: "owner",
    value: "Ada",
    effectiveDate: null,
    evidence,
    status: "accepted",
    conflict: false,
    historical: false,
    createdAt: "2026-10-05T00:00:00.000Z",
  };
  const fact: Project["approved"][number] = {
    id: "fact-1",
    candidateId: candidate.id,
    entity: candidate.entity,
    field: candidate.field,
    value: candidate.value,
    effectiveDate: null,
    evidence,
    revision: 1,
  };
  return {
    id,
    name: "Legacy Atlas",
    revision: 1,
    createdAt: "2026-10-05T00:00:00.000Z",
    notes: [
      {
        id: "note-1",
        sourceId: "source",
        sourceVersion: "1",
        markdown: "Ada",
        sourceDate: null,
        checksum: evidence.checksum,
        documentRef: evidence.documentRef,
        status: "review",
        indexStatus: "ready",
        runId: "run-1",
        error: null,
      },
    ],
    candidates: [candidate],
    approved: [fact],
    history: [fact],
    reviews: [
      {
        id: "review-1",
        candidateId: candidate.id,
        action: "accept",
        original: candidate,
        correction: null,
        revision: 1,
        createdAt: "2026-10-05T00:01:00.000Z",
      },
    ],
    conversations: [
      {
        id: "conversation-1",
        messages: [
          {
            id: "message-1",
            question: "Who owns Release?",
            runId: "question-run-1",
            answer: {
              text: "Ada owns Release.",
              claims: [
                {
                  factId: fact.id,
                  evidence,
                  entity: fact.entity,
                  field: fact.field,
                  value: fact.value,
                },
              ],
              suggestions: [],
              questions: [],
              pendingReview: 0,
              missingEmbeddings: 0,
              status: "answered",
            },
            createdAt: "2026-10-05T00:02:00.000Z",
          },
        ],
      },
    ],
  };
}

describe("SQL projects repository", () => {
  it("reads and saves a pre-existing populated aggregate without losing its nested state", () => {
    const { database, repository } = context();
    const project = legacyProject();
    const data = JSON.stringify(project);
    database
      .prepare("INSERT INTO projects(id,data) VALUES (?,?)")
      .run(project.id, data);

    expect(repository.get(project.id)).toEqual(project);
    expect(repository.list()).toEqual([project]);
    repository.save(repository.get(project.id));
    expect(
      database.prepare("SELECT data FROM projects WHERE id=?").get(project.id),
    ).toEqual({ data });
  });

  it("returns detached nested records from get and list until explicitly saved", () => {
    const { repository } = context();
    const project = legacyProject();
    repository.save(project);
    const read = repository.get(project.id);
    read.name = "Unsaved name";
    read.notes[0].markdown = "Unsaved content";
    read.approved[0].evidence.quote = "Unsaved evidence";
    const listed = repository.list();
    listed[0].conversations[0].messages[0].question = "Unsaved question";
    expect(repository.get(project.id)).toEqual(project);
    expect(repository.list()).toEqual([project]);

    repository.save(read);
    expect(repository.get(project.id)).toEqual(read);
  });

  it("lists newest inserted rows first without moving an updated project", () => {
    const { repository } = context();
    const first = legacyProject("first");
    const second = legacyProject("second");
    second.createdAt = "2020-01-01T00:00:00.000Z";
    repository.save(first);
    repository.save(second);
    first.name = "Updated first";
    repository.save(first);
    expect(repository.list()).toEqual([second, first]);
  });

  it("returns an empty list and preserves the missing-project error", () => {
    const { repository } = context();
    expect(repository.list()).toEqual([]);
    expect(() => repository.get("missing")).toThrow("Unknown project");
  });
});
