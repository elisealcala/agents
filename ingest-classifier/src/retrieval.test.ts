import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelClient } from "./providers/types.ts";
import { DocumentStore, type StoreDocumentInput } from "./documents.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import {
  answerQuestion,
  buildGroundedAnswerPrompt,
  retrieveDocuments,
  type RetrievalHit,
} from "./retrieval.ts";

const stores: DocumentStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // A test can close its store before cleanup.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function openDocuments(): Promise<DocumentStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), "retrieval-test-"));
  temporaryDirectories.push(root);
  const documents = new DocumentStore(path.join(root, "library.sqlite"));
  stores.push(documents);
  return documents;
}

function input(
  auditId: number,
  filename: string,
  embedding: number[] | null,
  cleanText: string,
  overrides: Partial<StoreDocumentInput> = {},
): StoreDocumentInput {
  return {
    auditId,
    sourcePath: `/vault/inbox/${filename}`,
    destinationPath: `/vault/library/architecture-code/${filename}`,
    categoryId: "architecture_code",
    summary: `Summary for ${filename}.`,
    cleanText,
    embedding,
    embeddingProvider: embedding ? "fixture-v1" : null,
    embeddingError: embedding ? null : "embedding unavailable",
    ...overrides,
  };
}

function provider(vector: number[]) {
  const embed = vi.fn<EmbeddingProvider["embed"]>(async (_text: string) => vector);
  return { id: "query-fixture-v1", dimensions: vector.length, embed };
}

function model(complete: ModelClient["complete"]): ModelClient {
  return {
    provider: "openai",
    model: "offline-answer-model",
    complete,
  };
}

describe("retrieveDocuments", () => {
  it("embeds only the query and ranks reusable stored vectors by cosine score", async () => {
    const documents = await openDocuments();
    documents.upsert(
      input(1, "exact.md", [1, 0], "  Exact   cache\n\n guidance with TTLs. "),
    );
    documents.upsert(
      input(2, "related.md", [0.8, 0.6], "Related cache invalidation guidance."),
    );
    documents.upsert(
      input(3, "irrelevant.md", [0, 1], "OAuth token rotation."),
    );
    documents.upsert(
      input(4, "missing.md", null, "A missing vector must never be embedded at query time."),
    );
    const embeddingProvider = provider([1, 0]);

    const hits = await retrieveDocuments({
      question: "  How should cache TTLs work?  ",
      documents,
      embeddingProvider,
      topK: 2,
      minimumScore: 0.2,
    });

    expect(embeddingProvider.embed).toHaveBeenCalledOnce();
    expect(embeddingProvider.embed).toHaveBeenCalledWith(
      "How should cache TTLs work?",
    );
    expect(hits).toEqual([
      {
        document: expect.objectContaining({
          auditId: 1,
          destinationPath: "/vault/library/architecture-code/exact.md",
          embedding: [1, 0],
        }),
        score: 1,
        snippet: "Exact cache guidance with TTLs.",
      },
      {
        document: expect.objectContaining({
          auditId: 2,
          destinationPath: "/vault/library/architecture-code/related.md",
          embedding: [0.8, 0.6],
        }),
        score: 0.8,
        snippet: "Related cache invalidation guidance.",
      },
    ]);
  });

  it("returns no hits for a blank question without embedding anything", async () => {
    const documents = await openDocuments();
    documents.upsert(input(1, "note.md", [1, 0], "Some text."));
    const embeddingProvider = provider([1, 0]);

    await expect(
      retrieveDocuments({ question: "   ", documents, embeddingProvider }),
    ).resolves.toEqual([]);
    expect(embeddingProvider.embed).not.toHaveBeenCalled();
  });

  it("skips stored vectors with dimensions incompatible with the query", async () => {
    const documents = await openDocuments();
    documents.upsert(input(1, "wrong-size.md", [1, 0, 0], "Wrong dimensions."));

    await expect(
      retrieveDocuments({
        question: "Question",
        documents,
        embeddingProvider: provider([1, 0]),
        minimumScore: -1,
      }),
    ).resolves.toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects an invalid topK of %s",
    async (topK) => {
      const documents = await openDocuments();
      const embeddingProvider = provider([1, 0]);

      await expect(
        retrieveDocuments({
          question: "Question",
          documents,
          embeddingProvider,
          topK,
        }),
      ).rejects.toThrow(/topK must be a positive integer/);
      expect(embeddingProvider.embed).not.toHaveBeenCalled();
    },
  );

  it.each([-1.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid minimum score of %s",
    async (minimumScore) => {
      const documents = await openDocuments();
      const embeddingProvider = provider([1, 0]);

      await expect(
        retrieveDocuments({
          question: "Question",
          documents,
          embeddingProvider,
          minimumScore,
        }),
      ).rejects.toThrow(/minimumScore must be between -1 and 1/);
      expect(embeddingProvider.embed).not.toHaveBeenCalled();
    },
  );
});

describe("answerQuestion", () => {
  it("returns an honest response for an empty question without calling embeddings or a model", async () => {
    const documents = await openDocuments();
    const embeddingProvider = provider([1, 0]);
    const complete = vi.fn<ModelClient["complete"]>();

    await expect(
      answerQuestion({
        question: "  ",
        documents,
        embeddingProvider,
        model: model(complete),
      }),
    ).resolves.toEqual({
      answer: "Please provide a non-empty question.",
      sources: [],
    });
    expect(embeddingProvider.embed).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("admits when no stored document is sufficiently relevant", async () => {
    const documents = await openDocuments();
    documents.upsert(input(1, "architecture.md", [1, 0], "Architecture notes."));
    const embeddingProvider = provider([0, 1]);
    const complete = vi.fn<ModelClient["complete"]>();

    await expect(
      answerQuestion({
        question: "What recipe should I cook?",
        documents,
        embeddingProvider,
        model: model(complete),
      }),
    ).resolves.toEqual({
      answer: "I couldn't find a sufficiently relevant source in the organized library.",
      sources: [],
    });
    expect(embeddingProvider.embed).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it("grounds the model prompt and attaches citations only from ranked records", async () => {
    const documents = await openDocuments();
    documents.upsert(
      input(1, "cache.md", [1, 0], "Measure cache hit rate and use explicit TTL values."),
    );
    documents.upsert(
      input(2, "rollout.md", [0.8, 0.6], "Rehearse invalidation before rollout."),
    );
    documents.upsert(
      input(3, "unrelated.md", [0, 1], "OAuth session rotation."),
    );
    const embeddingProvider = provider([1, 0]);
    const complete = vi.fn<ModelClient["complete"]>(async (_prompt: string) =>
      "Use explicit TTLs and rehearse invalidation. A model-only path is /invented.md.",
    );

    const result = await answerQuestion({
      question: "What is the cache rollout strategy?",
      documents,
      embeddingProvider,
      model: model(complete),
      topK: 2,
    });

    expect(complete).toHaveBeenCalledOnce();
    const prompt = complete.mock.calls[0]?.[0];
    expect(prompt).toContain("using only the grounded excerpts");
    expect(prompt).toContain("/vault/library/architecture-code/cache.md");
    expect(prompt).toContain("/vault/library/architecture-code/rollout.md");
    expect(prompt).not.toContain("/vault/library/architecture-code/unrelated.md");
    expect(result.sources).toEqual([
      {
        path: "/vault/library/architecture-code/cache.md",
        score: 1,
        snippet: "Measure cache hit rate and use explicit TTL values.",
      },
      {
        path: "/vault/library/architecture-code/rollout.md",
        score: 0.8,
        snippet: "Rehearse invalidation before rollout.",
      },
    ]);
    expect(result.sources.some(({ path: sourcePath }) => sourcePath === "/invented.md"))
      .toBe(false);
    const sourceList = result.answer.split("\n\nSources:\n")[1];
    expect(sourceList).toBe(
      "- /vault/library/architecture-code/cache.md\n- /vault/library/architecture-code/rollout.md",
    );
    expect(sourceList).not.toContain("invented.md");
  });

  it("can answer deterministically from snippets without a completion model", async () => {
    const documents = await openDocuments();
    documents.upsert(input(1, "source.md", [1, 0], "Grounded local guidance."));

    const result = await answerQuestion({
      question: "What guidance exists?",
      documents,
      embeddingProvider: provider([1, 0]),
    });

    expect(result.answer).toContain(
      "Grounded local guidance. [/vault/library/architecture-code/source.md]",
    );
    expect(result.answer).toContain(
      "Sources:\n- /vault/library/architecture-code/source.md",
    );
    expect(result.sources).toHaveLength(1);
  });
});

describe("buildGroundedAnswerPrompt", () => {
  it("includes only the supplied hits with their summaries, excerpts, and paths", async () => {
    const documents = await openDocuments();
    const stored = documents.upsert(
      input(1, "real.md", [1, 0], "Only this excerpt is grounded."),
    );
    const hits: RetrievalHit[] = [
      { document: stored, score: 1, snippet: "Only this excerpt is grounded." },
    ];

    const prompt = buildGroundedAnswerPrompt("What is grounded?", hits);

    expect(prompt).toContain("Do not name or cite any path not shown below.");
    expect(prompt).toContain("Question: What is grounded?");
    expect(prompt).toContain(`[1] Path: ${stored.destinationPath}`);
    expect(prompt).toContain(`Summary: ${stored.summary}`);
    expect(prompt).toContain("Excerpt: Only this excerpt is grounded.");
    expect(prompt).not.toContain("invented.md");
  });
});
