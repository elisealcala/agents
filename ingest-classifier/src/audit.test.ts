import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuditStore } from "./audit.ts";

const stores: AuditStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // A persistence test may already have closed this handle.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createStore(): Promise<AuditStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "audit-test-"));
  temporaryDirectories.push(directory);
  const store = new AuditStore(path.join(directory, "state", "audit.sqlite"));
  stores.push(store);
  return store;
}

function begin(store: AuditStore, filename = "note.md", sha = "sha-1"): number {
  const id = store.begin({
    sourcePath: `/vault/inbox/${filename}`,
    sourceSha256: sha,
    provider: "openai",
    model: "offline-test-model",
  });
  if (id === null) throw new Error("expected a new audit record");
  return id;
}

describe("AuditStore", () => {
  it("records a complete classification and returns query-ready domain fields", async () => {
    const store = await createStore();
    const id = begin(store);
    store.recordEvent(id, "parse", "ok", "42 characters");
    store.setClassification(id, {
      category: "architecture_code",
      summary: "An API design note.",
      tags: ["api", "design"],
      confidence_score: 0.91,
    });
    store.recordEvent(id, "classify", "ok");
    store.setDestination(id, "/vault/library/architecture-code/note.md");
    store.recordEvent(id, "move", "ok");
    store.complete(id);

    expect(store.list()).toEqual([
      {
        id,
        sourcePath: "/vault/inbox/note.md",
        destinationPath: "/vault/library/architecture-code/note.md",
        sourceSha256: "sha-1",
        category: "architecture_code",
        summary: "An API design note.",
        tags: ["api", "design"],
        confidence: 0.91,
        provider: "openai",
        model: "offline-test-model",
        status: "ok",
        error: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
    expect(store.findByFilename("note.md")).toEqual(store.list());
    expect(store.list("ok")).toHaveLength(1);
    expect(store.list("failed")).toEqual([]);
  });

  it("persists records after the SQLite connection is closed and reopened", async () => {
    const store = await createStore();
    const databasePath = store.databasePath;
    const id = begin(store, "persistent.md", "persistent-sha");
    store.setClassification(id, {
      category: "meeting_notes",
      summary: "Weekly decisions.",
      tags: ["weekly"],
      confidence_score: 0.82,
    });
    store.setDestination(id, "/vault/library/meeting-notes/renamed-note.md");
    store.complete(id);
    store.close();

    const reopened = new AuditStore(databasePath);
    stores.push(reopened);

    expect(reopened.list("ok")).toEqual([
      expect.objectContaining({
        id,
        sourcePath: "/vault/inbox/persistent.md",
        destinationPath: "/vault/library/meeting-notes/renamed-note.md",
        sourceSha256: "persistent-sha",
        category: "meeting_notes",
        tags: ["weekly"],
        status: "ok",
      }),
    ]);
    expect(reopened.findByFilename("renamed-note.md")).toHaveLength(1);
    expect(reopened.findByFilename("not-present.md")).toEqual([]);
  });

  it("prevents duplicate processing of records already processing or complete", async () => {
    const store = await createStore();
    const id = begin(store);

    expect(
      store.begin({
        sourcePath: "/vault/inbox/note.md",
        sourceSha256: "sha-1",
        provider: "anthropic",
        model: "another-model",
      }),
    ).toBeNull();

    store.setClassification(id, {
      category: "project_specs",
      summary: "A roadmap.",
      tags: [],
      confidence_score: 1,
    });
    store.setDestination(id, "/vault/library/project-specs/note.md");
    store.complete(id);

    expect(
      store.begin({
        sourcePath: "/vault/inbox/note.md",
        sourceSha256: "sha-1",
        provider: "anthropic",
        model: "another-model",
      }),
    ).toBeNull();
    expect(store.list()).toHaveLength(1);
  });

  it("reuses a failed record for a later retry and resets transient fields", async () => {
    const store = await createStore();
    const id = begin(store, "retry.md", "retry-sha");
    store.fail({
      auditId: id,
      sourcePath: "/vault/inbox/retry.md",
      stage: "classify",
      error: "bad schema",
    });

    expect(store.list("failed")).toEqual([
      expect.objectContaining({ id, error: "bad schema", status: "failed" }),
    ]);
    expect(
      store.begin({
        sourcePath: "/vault/inbox/retry.md",
        sourceSha256: "retry-sha",
        provider: "xai",
        model: "retry-model",
      }),
    ).toBe(id);
    expect(store.list()).toEqual([
      expect.objectContaining({
        id,
        provider: "xai",
        model: "retry-model",
        status: "processing",
        error: null,
        destinationPath: null,
      }),
    ]);
  });

  it("audits skipped files idempotently by path and fingerprint", async () => {
    const store = await createStore();

    store.skip("/vault/inbox/photo.png", "stat:12:123", "non-Markdown file");
    store.skip("/vault/inbox/photo.png", "stat:12:123", "non-Markdown file");
    store.skip("/vault/inbox/photo.png", "stat:13:124", "non-Markdown file");

    expect(store.list("skipped")).toEqual([
      expect.objectContaining({
        sourcePath: "/vault/inbox/photo.png",
        sourceSha256: "stat:12:123",
        status: "skipped",
        error: "non-Markdown file",
      }),
      expect.objectContaining({
        sourcePath: "/vault/inbox/photo.png",
        sourceSha256: "stat:13:124",
        status: "skipped",
        error: "non-Markdown file",
      }),
    ]);
  });

  it("refuses to mark an incomplete record successful", async () => {
    const store = await createStore();
    const id = begin(store, "incomplete.md");

    expect(() => store.complete(id)).toThrow(
      /audit .* is incomplete and cannot be marked successful/,
    );
    expect(store.list()).toEqual([
      expect.objectContaining({ id, status: "processing" }),
    ]);
  });

  it("creates a standalone failed record when parsing fails before begin", async () => {
    const store = await createStore();

    const id = store.fail({
      sourcePath: "/vault/inbox/invalid.md",
      stage: "parse",
      error: "invalid UTF-8",
    });

    expect(store.list("failed")).toEqual([
      expect.objectContaining({
        id,
        sourcePath: "/vault/inbox/invalid.md",
        sourceSha256: "unavailable",
        provider: null,
        model: null,
        status: "failed",
        error: "invalid UTF-8",
      }),
    ]);
  });
});
