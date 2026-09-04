import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runClusteringJob,
  suggestTaxonomySplits,
} from "./clustering.ts";
import { DocumentStore, type StoredDocument } from "./documents.ts";

const stores: DocumentStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // A test may already have closed its store.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clustering-test-"));
  temporaryDirectories.push(root);
  return root;
}

function document(
  id: number,
  categoryId: string,
  embedding: number[] | null,
  cleanText: string,
  filename = `note-${id}.md`,
  destinationFolder = "/vault/library/architecture-code",
): StoredDocument {
  return {
    id,
    auditId: id,
    sourcePath: `/vault/inbox/${filename}`,
    destinationPath: path.join(destinationFolder, filename),
    categoryId,
    summary: `Summary ${id}.`,
    cleanText,
    embedding,
    embeddingProvider: embedding ? "fixture-v1" : null,
    embeddingStatus: embedding ? "ready" : "missing",
    embeddingError: embedding ? null : "not embedded",
    createdAt: "2026-09-04 00:00:00",
    updatedAt: "2026-09-04 00:00:00",
  };
}

function splitDocuments(destinationFolder?: string): StoredDocument[] {
  return [
    document(1, "architecture_code", [1, 0], "cache redis ttl", "cache-1.md", destinationFolder),
    document(2, "architecture_code", [1, 0], "cache redis ttl", "cache-2.md", destinationFolder),
    document(3, "architecture_code", [1, 0], "cache redis ttl", "cache-3.md", destinationFolder),
    document(4, "architecture_code", [0, 1], "oauth session token", "auth-1.md", destinationFolder),
    document(5, "architecture_code", [0, 1], "oauth session token", "auth-2.md", destinationFolder),
    document(6, "architecture_code", [0, 1], "oauth session token", "auth-3.md", destinationFolder),
  ];
}

describe("suggestTaxonomySplits", () => {
  it("deterministically suggests two labeled groups with representative files", () => {
    const documents = splitDocuments();

    const first = suggestTaxonomySplits(documents);
    const repeated = suggestTaxonomySplits(documents);

    expect(repeated).toEqual(first);
    expect(first).toEqual([
      {
        action: "split",
        categoryId: "architecture_code",
        reason: expect.stringContaining(
          "6 documents form two meaningfully separated groups",
        ),
        separation: 1,
        clusters: [
          {
            label: "cache / redis / ttl",
            documentCount: 3,
            exampleFiles: ["cache-1.md", "cache-2.md", "cache-3.md"],
          },
          {
            label: "oauth / session / token",
            documentCount: 3,
            exampleFiles: ["auth-1.md", "auth-2.md", "auth-3.md"],
          },
        ],
      },
    ]);
  });

  it("does not suggest a split for small, homogeneous, or unembedded groups", () => {
    const small = splitDocuments().slice(0, 5);
    const homogeneous = Array.from({ length: 6 }, (_, index) =>
      document(index + 1, "reference_material", [1, 0], "same topic words"),
    );
    const missing = Array.from({ length: 8 }, (_, index) =>
      document(index + 1, "meeting_notes", null, "meeting topic"),
    );

    expect(suggestTaxonomySplits(small)).toEqual([]);
    expect(suggestTaxonomySplits(homogeneous)).toEqual([]);
    expect(suggestTaxonomySplits(missing)).toEqual([]);
  });

  it("respects configurable category, cluster, and separation floors", () => {
    const fourDocuments = splitDocuments().slice(0, 2).concat(splitDocuments().slice(3, 5));

    expect(suggestTaxonomySplits(fourDocuments)).toEqual([]);
    expect(
      suggestTaxonomySplits(fourDocuments, {
        minimumCategorySize: 4,
        minimumClusterSize: 2,
        minimumSeparation: 1,
      }),
    ).toHaveLength(1);
    expect(
      suggestTaxonomySplits(fourDocuments, {
        minimumCategorySize: 4,
        minimumClusterSize: 3,
      }),
    ).toEqual([]);
  });
});

describe("runClusteringJob", () => {
  it("writes an inspectable report without moving or changing any source document", async () => {
    const root = await temporaryRoot();
    const library = path.join(root, "library", "architecture-code");
    await mkdir(library, { recursive: true });
    const documents = new DocumentStore(path.join(root, "library.sqlite"));
    stores.push(documents);
    const fixtures = splitDocuments(library);
    for (const fixture of fixtures) {
      await writeFile(fixture.destinationPath, fixture.cleanText, "utf8");
      documents.upsert({
        auditId: fixture.auditId,
        sourcePath: fixture.sourcePath,
        destinationPath: fixture.destinationPath,
        categoryId: fixture.categoryId,
        summary: fixture.summary,
        cleanText: fixture.cleanText,
        embedding: fixture.embedding,
        embeddingProvider: fixture.embeddingProvider,
      });
    }
    documents.upsert({
      auditId: 99,
      sourcePath: "/vault/inbox/missing.md",
      destinationPath: "/vault/library/meeting-notes/missing.md",
      categoryId: "meeting_notes",
      summary: "Missing embedding.",
      cleanText: "meeting notes",
      embedding: null,
      embeddingProvider: null,
      embeddingError: "retry later",
    });
    const filenamesBefore = await readdir(library);
    const outputPath = path.join(root, "reports", "cluster-suggestions.json");
    await mkdir(path.dirname(outputPath));

    const report = await runClusteringJob({ documents, outputPath });

    expect(report.examinedCategories).toBe(1);
    expect(report.generatedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    expect(report.suggestions).toHaveLength(1);
    const written = JSON.parse(await readFile(outputPath, "utf8")) as typeof report;
    expect(written).toEqual(report);
    expect(await readdir(library)).toEqual(filenamesBefore);
    for (const fixture of fixtures) {
      await expect(readFile(fixture.destinationPath, "utf8")).resolves.toBe(
        fixture.cleanText,
      );
    }
  });
});
