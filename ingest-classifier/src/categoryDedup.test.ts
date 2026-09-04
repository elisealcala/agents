import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CATEGORY_DEDUP_THRESHOLD,
  resolveCategoryProposal,
} from "./categoryDedup.ts";
import {
  categoryText,
  type CategoryProposal,
  type StoredCategory,
} from "./categories.ts";
import {
  LocalHashEmbedding,
  cosineSimilarity,
  type EmbeddingProvider,
} from "./embeddings.ts";
import { SEED_CATEGORIES } from "./taxonomy.ts";

function storedCategory(
  id: string,
  embedding: number[] | null,
  definition = "Notes about this category.",
): StoredCategory {
  return {
    id,
    name: id.replaceAll("_", " "),
    definition,
    folder: id.replaceAll("_", "-"),
    embedding,
    embeddingProvider: embedding ? "fixture-v1" : null,
    isSeed: false,
    createdAt: "2026-09-04 00:00:00",
  };
}

function fixtureProvider(vector: number[]) {
  const embed = vi.fn<EmbeddingProvider["embed"]>(async (_text: string) => vector);
  return {
    id: "fixture-v1",
    dimensions: vector.length,
    embed,
  };
}

const PROPOSAL: CategoryProposal = {
  name: "Candidate Topic",
  definition: "A proposed category used in tests.",
};

describe("resolveCategoryProposal", () => {
  it("merges with the nearest category only when similarity is above 0.85", async () => {
    expect(DEFAULT_CATEGORY_DEDUP_THRESHOLD).toBe(0.85);
    const provider = fixtureProvider([1, 0]);
    const exact = storedCategory("exact_theme", [1, 0]);
    const weaker = storedCategory("weaker_theme", [0.8, 0.6]);

    const result = await resolveCategoryProposal(
      PROPOSAL,
      [weaker, exact],
      provider,
    );

    expect(result).toEqual({
      action: "merge",
      category: exact,
      similarity: 1,
      embedding: [1, 0],
    });
    expect(provider.embed).toHaveBeenCalledOnce();
    expect(provider.embed).toHaveBeenCalledWith(categoryText(PROPOSAL));
  });

  it("creates when the nearest category is below the default threshold", async () => {
    const result = await resolveCategoryProposal(
      PROPOSAL,
      [storedCategory("different_theme", [0.8, 0.6])],
      fixtureProvider([1, 0]),
    );

    expect(result).toEqual({
      action: "create",
      similarity: 0.8,
      embedding: [1, 0],
    });
  });

  it("uses a strict greater-than comparison at the configured threshold", async () => {
    const proposalVector = [1, 0];
    const categoryVector = [3, 4];
    const boundary = cosineSimilarity(proposalVector, categoryVector);
    const category = storedCategory("boundary_theme", categoryVector);

    const atBoundary = await resolveCategoryProposal(
      PROPOSAL,
      [category],
      fixtureProvider(proposalVector),
      boundary,
    );
    const belowBoundary = await resolveCategoryProposal(
      PROPOSAL,
      [category],
      fixtureProvider(proposalVector),
      boundary - 0.01,
    );

    expect(boundary).toBe(0.6);
    expect(atBoundary.action).toBe("create");
    expect(belowBoundary).toEqual(
      expect.objectContaining({ action: "merge", category, similarity: boundary }),
    );
  });

  it("allows the duplicate threshold to be configured", async () => {
    const category = storedCategory("related_theme", [0.8, 0.6]);

    await expect(
      resolveCategoryProposal(
        PROPOSAL,
        [category],
        fixtureProvider([1, 0]),
        0.7,
      ),
    ).resolves.toEqual(expect.objectContaining({ action: "merge" }));
    await expect(
      resolveCategoryProposal(
        PROPOSAL,
        [category],
        fixtureProvider([1, 0]),
        0.9,
      ),
    ).resolves.toEqual(expect.objectContaining({ action: "create" }));
  });

  it.each([-1.01, 1.01, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects an out-of-range threshold of %s",
    async (threshold) => {
      await expect(
        resolveCategoryProposal(
          PROPOSAL,
          [],
          fixtureProvider([1, 0]),
          threshold,
        ),
      ).rejects.toThrow(/threshold must be between -1 and 1/);
    },
  );

  it("ignores categories with missing or incompatible embeddings", async () => {
    const result = await resolveCategoryProposal(
      PROPOSAL,
      [
        storedCategory("missing", null),
        storedCategory("wrong_dimensions", [1, 0, 0]),
      ],
      fixtureProvider([1, 0]),
    );

    expect(result).toEqual({
      action: "create",
      similarity: -1,
      embedding: [1, 0],
    });
  });

  it("merges a known architecture paraphrase but creates a novel fixture theme", async () => {
    const provider = new LocalHashEmbedding();
    const categories: StoredCategory[] = await Promise.all(
      SEED_CATEGORIES.map(async (category) => ({
        ...category,
        embedding: await provider.embed(categoryText(category)),
        embeddingProvider: provider.id,
        isSeed: true,
        createdAt: "2026-09-04 00:00:00",
      })),
    );
    const architecture = categories.find(({ id }) => id === "architecture_code")!;

    const paraphrase = await resolveCategoryProposal(
      {
        name: "Architecture and Code",
        definition:
          "Technical designs, API definitions, system architecture, and code notes.",
      },
      categories,
      provider,
    );
    const novel = await resolveCategoryProposal(
      {
        name: "Equipment Maintenance",
        definition:
          "Guides about maintaining bicycles, repairing chains, and tuning brakes.",
      },
      categories,
      provider,
    );

    expect(paraphrase).toEqual(
      expect.objectContaining({
        action: "merge",
        category: architecture,
        similarity: 1,
      }),
    );
    expect(novel).toEqual(expect.objectContaining({ action: "create" }));
  });
});
