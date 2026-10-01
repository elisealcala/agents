import { describe, expect, it } from "vitest";
import { classifyWithLiveTaxonomy } from "../src/classification/adaptive-classifier.ts";
import type { CompletionInput } from "../src/providers/types.ts";
import type { StoredCategory } from "../src/storage/categories.ts";
import { SEED_CATEGORIES } from "../src/taxonomy/taxonomy.ts";
import { AdaptiveFixtureModelClient } from "./adaptive-fixture-model.ts";

function storedCategories(): StoredCategory[] {
  return SEED_CATEGORIES.map((category) => ({
    ...category,
    parentId: null,
    embedding: null,
    embeddingProvider: null,
    isSeed: true,
    createdAt: "2026-09-04 00:00:00",
  }));
}

function dynamicCategory(
  id: string,
  name: string,
  definition: string,
): StoredCategory {
  return {
    id,
    name,
    definition,
    folder: id.replaceAll("_", "-"),
    parentId: "personal_ideas",
    embedding: [1, 0],
    embeddingProvider: "fixture-v1",
    isSeed: false,
    createdAt: "2026-09-04 00:00:00",
  };
}

describe("AdaptiveFixtureModelClient", () => {
  it.each([
    ["product requirement", "# Roadmap\nLaunch requirements.", "project_specs"],
    [
      "architecture note",
      "# API\nDatabase and cache design.",
      "architecture_code",
    ],
    ["meeting record", "# Meeting\nAttendees and minutes.", "meeting_notes"],
    [
      "personal idea",
      "# Journal\nA reflection and experiment.",
      "personal_ideas",
    ],
    [
      "reference note",
      "# Reading\nExternal sources for later.",
      "reference_material",
    ],
  ])(
    "files a natural %s into an existing seed",
    async (_name, note, category) => {
      await expect(
        classifyWithLiveTaxonomy(
          new AdaptiveFixtureModelClient(),
          note,
          storedCategories(),
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          action: "existing",
          category,
          confidence_score: 0.94,
          fit_score: 0.92,
        }),
      );
    },
  );

  it("proposes equipment maintenance once and reuses it after it becomes live", async () => {
    const client = new AdaptiveFixtureModelClient();
    const seeds = storedCategories();
    const note = "# Bicycle maintenance\nRepair a bike chain and brakes.";

    await expect(
      classifyWithLiveTaxonomy(client, note, seeds),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "propose",
        parent: "personal_ideas",
        proposal: {
          name: "Equipment Maintenance",
          definition:
            "Guides and notes about maintaining and repairing bicycles and equipment.",
        },
      }),
    );

    const equipment = dynamicCategory(
      "equipment_maintenance",
      "Equipment Maintenance",
      "Guides and notes about maintaining and repairing bicycles and equipment.",
    );
    await expect(
      classifyWithLiveTaxonomy(client, note, [...seeds, equipment]),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "existing",
        category: "equipment_maintenance",
      }),
    );
  });

  it("proposes recipes until the recipes category is live", async () => {
    const client = new AdaptiveFixtureModelClient();
    const seeds = storedCategories();
    const note = "# Cooking recipe\nPrepare ingredients and roast squash.";

    await expect(
      classifyWithLiveTaxonomy(client, note, seeds),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "propose",
        parent: "personal_ideas",
        proposal: expect.objectContaining({ name: "Recipes Cooking" }),
      }),
    );

    const recipes = dynamicCategory(
      "recipes_cooking",
      "Recipes Cooking",
      "Recipes, cooking techniques, ingredients, and meal preparation notes.",
    );
    await expect(
      classifyWithLiveTaxonomy(client, note, [...seeds, recipes]),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "existing",
        category: "recipes_cooking",
      }),
    );
  });

  it("keeps an architecture paraphrase on the existing architecture category", async () => {
    await expect(
      classifyWithLiveTaxonomy(
        new AdaptiveFixtureModelClient(),
        "# Dedup candidate\nSoftware design should reuse architecture.",
        storedCategories(),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "existing",
        category: "architecture_code",
      }),
    );
  });

  it("uses the grounded Q&A response path instead of a placement", async () => {
    const client = new AdaptiveFixtureModelClient();
    const input: CompletionInput = {
      system: "Answer using this context.",
      user: `Question: What is the Q3 cache strategy?

Grounded excerpts:
[1] Path: /vault/q3-cache.md
Excerpt: Measure cache hit rate, choose TTLs, and rehearse invalidation.`,
    };

    const response = await client.complete(input);

    expect(response).toBe(
      "The grounded notes emphasize measuring cache hit rate, choosing explicit TTLs, and rehearsing invalidation before rollout.",
    );
    expect(() => JSON.parse(response)).toThrow();
  });
});
