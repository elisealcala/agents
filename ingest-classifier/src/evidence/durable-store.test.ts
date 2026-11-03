import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceIngestInput } from "./contracts.ts";
import {
  DurableEvidenceStore,
  type DurableEvidenceSqlStorage,
} from "./durable-store.ts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

type SqlValue = string | number | null;
function fixture(): {
  db: DatabaseSync;
  storage: DurableEvidenceSqlStorage;
  failNextKeyWrite(): void;
} {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  let failKeyWrite = false;
  const storage: DurableEvidenceSqlStorage = {
    sql: {
      exec(query: string, ...args: SqlValue[]) {
        if (
          failKeyWrite &&
          query.includes("INSERT OR IGNORE INTO project_evidence_keys")
        ) {
          failKeyWrite = false;
          throw new Error("Synthetic key write failure");
        }
        if (query.includes("CREATE TABLE IF NOT EXISTS project_evidence")) {
          db.exec(query);
          return { toArray: () => [] };
        }
        const statement = db.prepare(query);
        if (statement.columns().length) {
          const rows = statement.all(...args);
          return { toArray: () => rows };
        }
        statement.run(...args);
        return { toArray: () => [] };
      },
    },
    transactionSync<T>(operation: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = operation();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    db,
    storage,
    failNextKeyWrite: () => {
      failKeyWrite = true;
    },
  };
}

function input(
  overrides: Partial<EvidenceIngestInput> = {},
): EvidenceIngestInput {
  return {
    projectId: "atlas",
    sourceId: "meeting-1",
    sourceVersion: "v1",
    idempotencyKey: "atlas-note-1",
    markdown: "# Original 🧭\r\n\r\nAva owns Cache.  \n",
    sourceDate: "2026-10-05",
    ...overrides,
  };
}

describe("durable project evidence store", () => {
  it("preserves exact source bytes and identity across store reconstruction", () => {
    const { storage } = fixture();
    const note = input();
    const first = new DurableEvidenceStore(storage);
    const saved = first.register(note);
    expect(saved).toMatchObject({
      projectId: note.projectId,
      sourceId: note.sourceId,
      sourceVersion: note.sourceVersion,
      sourceDate: note.sourceDate,
      markdown: note.markdown,
      checksum: createHash("sha256").update(note.markdown).digest("hex"),
      auditId: null,
      error: null,
    });
    first.close();
    const reopened = new DurableEvidenceStore(storage);
    expect(reopened.get(note.projectId, saved.documentRef)).toEqual(saved);
    expect(reopened.list(note.projectId)).toEqual([saved]);
    expect(reopened.get("unknown-project", saved.documentRef)).toBeNull();
  });

  it("reuses source/version and retry keys while rejecting conflicting bindings", () => {
    const { storage } = fixture();
    const store = new DurableEvidenceStore(storage);
    const saved = store.register(input());
    expect(store.register(input())).toEqual(saved);
    expect(store.register(input({ idempotencyKey: "alias" }))).toEqual(saved);
    expect(() =>
      store.register(input({ markdown: "Different content" })),
    ).toThrow(/already bound/);
    expect(() =>
      store.register(
        input({ sourceDate: "2026-10-06", idempotencyKey: "other" }),
      ),
    ).toThrow(/already bound/);
    expect(() => store.register(input({ projectId: "other-project" }))).toThrow(
      /already bound/,
    );
    expect(() => store.register(input({ sourceVersion: "v2" }))).toThrow(
      /already bound/,
    );
    expect(store.list("atlas")).toEqual([saved]);
    expect(store.list("other-project")).toEqual([]);
  });

  it("keeps chunks and embeddings project-scoped and preserves UTF-16 offsets", () => {
    const { storage } = fixture();
    const store = new DurableEvidenceStore(storage);
    const markdown = `${"a".repeat(1499)}🧭 tail\n\nNext paragraph.`;
    const first = store.register(input({ markdown }));
    const second = store.register(
      input({
        projectId: "other",
        sourceId: "other",
        idempotencyKey: "other-key",
        markdown: "Other secret",
      }),
    );
    store.ensureChunks(first);
    store.ensureChunks(first);
    store.ensureChunks(second);
    const chunks = store.chunks("atlas", first.documentRef);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks[0]?.end).toBe(1499);
    expect(
      chunks.map((chunk) => markdown.slice(chunk.start, chunk.end)).join(""),
    ).toBe(markdown);
    expect(chunks.every((chunk) => chunk.record.projectId === "atlas")).toBe(
      true,
    );
    store.setChunkEmbedding(
      first.documentRef,
      chunks[0]!.start,
      [0.25, 0.75],
      "fixture-v1",
    );
    expect(store.chunks("atlas", first.documentRef)[0]).toMatchObject({
      embedding: [0.25, 0.75],
      embeddingProvider: "fixture-v1",
    });
    expect(store.chunks("other", first.documentRef)).toEqual([]);
    expect(
      store.chunks("other").map((chunk) => chunk.record.documentRef),
    ).toEqual([second.documentRef]);
  });

  it("rolls back a new source if binding its idempotency key fails", () => {
    const { storage, failNextKeyWrite } = fixture();
    const store = new DurableEvidenceStore(storage);
    failNextKeyWrite();
    expect(() => store.register(input())).toThrow(
      "Synthetic key write failure",
    );
    expect(store.list("atlas")).toEqual([]);
    const saved = store.register(input());
    expect(store.list("atlas")).toEqual([saved]);
  });
});
