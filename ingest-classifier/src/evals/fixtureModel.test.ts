import { describe, expect, it } from "vitest";
import {
  buildClassificationPrompt,
  parseClassification,
} from "../classifier.ts";
import type { SeedCategoryId } from "../taxonomy.ts";
import { FixtureModelClient } from "./fixtureModel.ts";

describe("FixtureModelClient", () => {
  it.each<[string, string, SeedCategoryId]>([
    [
      "project specification",
      "# Feature spec\nThe requirement is an accessible launch flow.",
      "project_specs",
    ],
    [
      "architecture note",
      "# API design\nTypeScript endpoints and database boundaries.",
      "architecture_code",
    ],
    [
      "meeting record",
      "# Weekly meeting\nAttendees and action items.",
      "meeting_notes",
    ],
    [
      "personal idea",
      "# Journal\nA reflection and experiment for a calmer workflow.",
      "personal_ideas",
    ],
    [
      "reference material",
      "# Reading list\nExternal sources and useful links.",
      "reference_material",
    ],
  ])("classifies a natural %s from the same full prompt used by M1", async (_name, note, category) => {
    const client = new FixtureModelClient();

    const raw = await client.complete(buildClassificationPrompt(note));

    expect(parseClassification(raw)).toEqual(
      expect.objectContaining({ category }),
    );
  });
});
