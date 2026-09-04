import { describe, expect, it } from "vitest";
import {
  buildAdaptiveClassificationPrompt,
  parseAdaptiveClassification,
} from "../adaptiveClassifier.ts";
import type { StoredCategory } from "../categories.ts";
import { SEED_CATEGORIES } from "../taxonomy.ts";
import { AdaptiveFixtureModelClient } from "./adaptiveFixtureModel.ts";

function storedCategories(): StoredCategory[] {
  return SEED_CATEGORIES.map((category) => ({
    ...category,
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
    embedding: [1, 0],
    embeddingProvider: "fixture-v1",
    isSeed: false,
    createdAt: "2026-09-04 00:00:00",
  };
}

describe("AdaptiveFixtureModelClient", () => {
  it.each([
    ["product requirement", "# Roadmap\nLaunch requirements.", "project_specs"],
    ["architecture note", "# API\nDatabase and cache design.", "architecture_code"],
    ["meeting record", "# Meeting\nAttendees and minutes.", "meeting_notes"],
    ["personal idea", "# Journal\nA reflection and experiment.", "personal_ideas"],
    ["reference note", "# Reading\nExternal sources for later.", "reference_material"],
  ])("returns an existing seed for a natural %s", async (_name, note, category) => {
    const categories = storedCategories();
    const client = new AdaptiveFixtureModelClient();

    const raw = await client.complete(
      buildAdaptiveClassificationPrompt(note, categories),
    );

    expect(parseAdaptiveClassification(raw, categories)).toEqual(
      expect.objectContaining({
        action: "existing",
        category,
        confidence_score: 0.94,
        fit_score: 0.92,
      }),
    );
  });

  it("proposes equipment maintenance once and reuses it after it becomes live", async () => {
    const client = new AdaptiveFixtureModelClient();
    const seeds = storedCategories();
    const note = "# Bicycle maintenance\nRepair a bike chain and brakes.";

    const firstRaw = await client.complete(
      buildAdaptiveClassificationPrompt(note, seeds),
    );
    const first = parseAdaptiveClassification(firstRaw, seeds);

    expect(first).toEqual(
      expect.objectContaining({
        action: "propose",
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
    const live = [...seeds, equipment];
    const secondRaw = await client.complete(
      buildAdaptiveClassificationPrompt(note, live),
    );

    expect(parseAdaptiveClassification(secondRaw, live)).toEqual(
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

    const proposedRaw = await client.complete(
      buildAdaptiveClassificationPrompt(note, seeds),
    );
    expect(parseAdaptiveClassification(proposedRaw, seeds)).toEqual(
      expect.objectContaining({
        action: "propose",
        proposal: expect.objectContaining({ name: "Recipes Cooking" }),
      }),
    );

    const recipes = dynamicCategory(
      "recipes_cooking",
      "Recipes Cooking",
      "Recipes, cooking techniques, ingredients, and meal preparation notes.",
    );
    const live = [...seeds, recipes];
    const existingRaw = await client.complete(
      buildAdaptiveClassificationPrompt(note, live),
    );
    expect(parseAdaptiveClassification(existingRaw, live)).toEqual(
      expect.objectContaining({ action: "existing", category: "recipes_cooking" }),
    );
  });

  it("returns the known architecture paraphrase proposal used by dedup evaluation", async () => {
    const categories = storedCategories();
    const client = new AdaptiveFixtureModelClient();

    const raw = await client.complete(
      buildAdaptiveClassificationPrompt(
        "# Dedup candidate\nSoftware design should reuse architecture.",
        categories,
      ),
    );

    expect(parseAdaptiveClassification(raw, categories)).toEqual(
      expect.objectContaining({
        action: "propose",
        proposal: {
          name: "Architecture and Code",
          definition:
            "Technical designs, API definitions, system architecture, and code notes.",
        },
      }),
    );
  });
});
