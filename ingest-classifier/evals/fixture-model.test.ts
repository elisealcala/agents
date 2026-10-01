import { describe, expect, it } from "vitest";
import { classifyFile } from "../src/classification/classifier.ts";
import type { SeedCategoryId } from "../src/taxonomy/taxonomy.ts";
import { FixtureModelClient } from "./fixture-model.ts";

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
  ])(
    "files a natural %s through the organizer",
    async (_name, note, category) => {
      await expect(
        classifyFile(new FixtureModelClient(), note),
      ).resolves.toEqual(expect.objectContaining({ category }));
    },
  );
});
