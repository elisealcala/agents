import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuditStore } from "./audit.ts";
import {
  DocumentStore,
  backfillDocumentEmbeddings,
  type StoreDocumentInput,
} from "./documents.ts";
import type { EmbeddingProvider } from "./embeddings.ts";

type Closable = { close(): void };

const stores: Closable[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // Restart tests may already have closed a connection.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "documents-test-"));
  temporaryDirectories.push(root);
  return root;
}

function openDocuments(databasePath: string): DocumentStore {
  const documents = new DocumentStore(databasePath);
  stores.push(documents);
  return documents;
}

function documentInput(
  auditId: number,
  overrides: Partial<StoreDocumentInput> = {},
): StoreDocumentInput {
  return {
    auditId,
    sourcePath: `/vault/inbox/note-${auditId}.md`,
    destinationPath: `/vault/library/reference-material/note-${auditId}.md`,
    categoryId: "reference_material",
    summary: `Summary ${auditId}.`,
    cleanText: `Clean document text ${auditId}.`,
    embedding: [1, 0],
    embeddingProvider: "fixture-v1",
    ...overrides,
  };
}

function successfulAudit(
  audit: AuditStore,
  input: {
    sourcePath: string;
    destinationPath: string;
    category?: string;
    summary?: string;
  },
): number {
  const id = audit.begin({
    sourcePath: input.sourcePath,
    sourceSha256: `sha-${input.sourcePath}`,
    provider: "openai",
    model: "offline-model",
  });
  if (id === null) throw new Error("expected a new audit row");
  audit.setClassification(id, {
    category: input.category ?? "reference_material",
    summary: input.summary ?? "Legacy summary.",
    tags: ["legacy"],
    confidence_score: 0.9,
  });
  audit.setDestination(id, input.destinationPath);
  audit.complete(id);
  return id;
}

function embeddingProvider() {
  const embed = vi.fn<EmbeddingProvider["embed"]>(async (text: string) => [
    text.length,
    1,
  ]);
  return { id: "backfill-fixture-v1", dimensions: 2, embed };
}

describe("DocumentStore", () => {
  it("stores and queries both ready and recoverable missing rows", async () => {
    const root = await temporaryRoot();
    const documents = openDocuments(path.join(root, "library.sqlite"));

    const ready = documents.upsert(documentInput(1));
    const missing = documents.upsert(
      documentInput(2, {
        embedding: null,
        embeddingProvider: null,
        embeddingError: "embedding service unavailable",
      }),
    );

    expect(ready).toEqual(
      expect.objectContaining({
        auditId: 1,
        embedding: [1, 0],
        embeddingProvider: "fixture-v1",
        embeddingStatus: "ready",
        embeddingError: null,
      }),
    );
    expect(missing).toEqual(
      expect.objectContaining({
        auditId: 2,
        embedding: null,
        embeddingProvider: null,
        embeddingStatus: "missing",
        embeddingError: "embedding service unavailable",
      }),
    );
    expect(documents.list("ready")).toEqual([ready]);
    expect(documents.list("missing")).toEqual([missing]);
    expect(documents.list()).toEqual([ready, missing]);
    expect(documents.getByAuditId(999)).toBeNull();
  });

  it("upserts by audit id and can repair or delete the same durable row", async () => {
    const root = await temporaryRoot();
    const documents = openDocuments(path.join(root, "library.sqlite"));
    const missing = documents.upsert(
      documentInput(7, {
        embedding: null,
        embeddingProvider: null,
        embeddingError: "first attempt failed",
      }),
    );

    documents.setEmbedding(7, [0, 1], "fixture-v2");
    const repaired = documents.getByAuditId(7);

    expect(repaired).toEqual(
      expect.objectContaining({
        id: missing.id,
        auditId: 7,
        embedding: [0, 1],
        embeddingProvider: "fixture-v2",
        embeddingStatus: "ready",
        embeddingError: null,
      }),
    );
    const updated = documents.upsert(
      documentInput(7, {
        destinationPath: "/vault/library/project-specs/renamed.md",
        categoryId: "project_specs",
        summary: "Updated summary.",
        cleanText: "Updated clean text.",
        embedding: [0.5, 0.5],
      }),
    );
    expect(updated).toEqual(
      expect.objectContaining({
        id: missing.id,
        destinationPath: "/vault/library/project-specs/renamed.md",
        categoryId: "project_specs",
        summary: "Updated summary.",
        cleanText: "Updated clean text.",
      }),
    );

    documents.deleteByAuditId(7);
    expect(documents.getByAuditId(7)).toBeNull();
    expect(() => documents.setEmbedding(7, [1, 0], "fixture-v1")).toThrow(
      /document for audit 7 not found/,
    );
  });

  it("persists document content, vectors, and status across restart", async () => {
    const root = await temporaryRoot();
    const databasePath = path.join(root, "library.sqlite");
    const first = openDocuments(databasePath);
    const ready = first.upsert(documentInput(1));
    const missing = first.upsert(
      documentInput(2, {
        embedding: null,
        embeddingProvider: null,
        embeddingError: "retry later",
      }),
    );
    first.close();

    const restarted = openDocuments(databasePath);

    expect(restarted.getByAuditId(1)).toEqual(ready);
    expect(restarted.getByAuditId(2)).toEqual(missing);
    expect(restarted.list("ready")).toHaveLength(1);
    expect(restarted.list("missing")).toHaveLength(1);
  });
});

describe("backfillDocumentEmbeddings", () => {
  it("creates legacy document rows, repairs missing rows, and skips ready rows", async () => {
    const root = await temporaryRoot();
    const databasePath = path.join(root, "library.sqlite");
    const audit = new AuditStore(databasePath);
    stores.push(audit);
    const documents = openDocuments(databasePath);
    const library = path.join(root, "library");
    await mkdir(library);

    const legacyPath = path.join(library, "legacy.md");
    const missingPath = path.join(library, "missing.md");
    const readyPath = path.join(library, "ready.md");
    await writeFile(legacyPath, "# Legacy\nCreate a document row.", "utf8");
    await writeFile(missingPath, "# Missing\nRepair this vector.", "utf8");
    await writeFile(readyPath, "# Ready\nDo not re-embed this row.", "utf8");
    const legacyId = successfulAudit(audit, {
      sourcePath: path.join(root, "inbox", "legacy.md"),
      destinationPath: legacyPath,
      summary: "Legacy row.",
    });
    const missingId = successfulAudit(audit, {
      sourcePath: path.join(root, "inbox", "missing.md"),
      destinationPath: missingPath,
      summary: "Missing row.",
    });
    const readyId = successfulAudit(audit, {
      sourcePath: path.join(root, "inbox", "ready.md"),
      destinationPath: readyPath,
      summary: "Ready row.",
    });
    documents.upsert(
      documentInput(missingId, {
        sourcePath: path.join(root, "inbox", "missing.md"),
        destinationPath: missingPath,
        summary: "Missing row.",
        cleanText: "stale text",
        embedding: null,
        embeddingProvider: null,
        embeddingError: "initial embedding failed",
      }),
    );
    documents.upsert(
      documentInput(readyId, {
        sourcePath: path.join(root, "inbox", "ready.md"),
        destinationPath: readyPath,
        summary: "Ready row.",
        cleanText: "Ready Do not re-embed this row.",
        embedding: [1, 0],
      }),
    );
    const provider = embeddingProvider();

    const report = await backfillDocumentEmbeddings({
      audit,
      documents,
      embeddingProvider: provider,
    });

    expect(report).toEqual({ examined: 3, created: 1, repaired: 1, failed: 0 });
    expect(provider.embed).toHaveBeenCalledTimes(2);
    expect(documents.getByAuditId(legacyId)).toEqual(
      expect.objectContaining({
        summary: "Legacy row.",
        cleanText: "Legacy\nCreate a document row.",
        embeddingStatus: "ready",
        embeddingProvider: "backfill-fixture-v1",
      }),
    );
    expect(documents.getByAuditId(missingId)).toEqual(
      expect.objectContaining({
        summary: "Missing row.",
        cleanText: "Missing\nRepair this vector.",
        embeddingStatus: "ready",
        embeddingError: null,
      }),
    );
    expect(documents.getByAuditId(readyId)).toEqual(
      expect.objectContaining({ embedding: [1, 0], cleanText: "Ready Do not re-embed this row." }),
    );
  });

  it("keeps a missing row recoverable when a backfill attempt fails", async () => {
    const root = await temporaryRoot();
    const databasePath = path.join(root, "library.sqlite");
    const audit = new AuditStore(databasePath);
    stores.push(audit);
    const documents = openDocuments(databasePath);
    const destinationPath = path.join(root, "library", "not-present.md");
    const auditId = successfulAudit(audit, {
      sourcePath: path.join(root, "inbox", "not-present.md"),
      destinationPath,
    });
    documents.upsert(
      documentInput(auditId, {
        destinationPath,
        embedding: null,
        embeddingProvider: null,
        embeddingError: "first failure",
      }),
    );
    const provider = embeddingProvider();

    const report = await backfillDocumentEmbeddings({
      audit,
      documents,
      embeddingProvider: provider,
    });

    expect(report).toEqual({ examined: 1, created: 0, repaired: 0, failed: 1 });
    expect(provider.embed).not.toHaveBeenCalled();
    expect(documents.getByAuditId(auditId)).toEqual(
      expect.objectContaining({
        embedding: null,
        embeddingProvider: null,
        embeddingStatus: "missing",
        embeddingError: expect.stringContaining("ENOENT"),
      }),
    );
  });
});
