import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LOW_CONFIDENCE_FALLBACK,
  LOW_CONFIDENCE_THRESHOLD,
  SEED_CATEGORIES,
  ensureLibraryLayout,
  getLibraryPaths,
  getSeedCategory,
  isSeedCategoryId,
} from "./taxonomy.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "taxonomy-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("seed taxonomy", () => {
  it("defines the five fixed M1 categories with unique ids and folders", () => {
    expect(SEED_CATEGORIES).toEqual([
      expect.objectContaining({ id: "project_specs", folder: "project-specs" }),
      expect.objectContaining({
        id: "architecture_code",
        folder: "architecture-code",
      }),
      expect.objectContaining({ id: "meeting_notes", folder: "meeting-notes" }),
      expect.objectContaining({ id: "personal_ideas", folder: "personal-ideas" }),
      expect.objectContaining({
        id: "reference_material",
        folder: "reference-material",
      }),
    ]);
    expect(new Set(SEED_CATEGORIES.map(({ id }) => id)).size).toBe(5);
    expect(new Set(SEED_CATEGORIES.map(({ folder }) => folder)).size).toBe(5);
    expect(SEED_CATEGORIES.every(({ name, definition }) => name && definition)).toBe(
      true,
    );
  });

  it("uses reference material for classifications below the confidence boundary", () => {
    expect(LOW_CONFIDENCE_FALLBACK).toBe("reference_material");
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  it("recognizes and retrieves only seed category ids", () => {
    for (const category of SEED_CATEGORIES) {
      expect(isSeedCategoryId(category.id)).toBe(true);
      expect(getSeedCategory(category.id)).toEqual(category);
    }

    expect(isSeedCategoryId("new_model_category")).toBe(false);
    expect(isSeedCategoryId("")).toBe(false);
  });
});

describe("library layout", () => {
  it("resolves all paths underneath the requested root", async () => {
    const parent = await temporaryDirectory();
    const relativeRoot = path.relative(process.cwd(), path.join(parent, "vault"));
    const paths = getLibraryPaths(relativeRoot);

    expect(paths).toEqual({
      root: path.resolve(relativeRoot),
      inbox: path.resolve(relativeRoot, "inbox"),
      database: path.resolve(relativeRoot, "ingest-classifier.sqlite"),
      categories: {
        project_specs: path.resolve(relativeRoot, "library/project-specs"),
        architecture_code: path.resolve(relativeRoot, "library/architecture-code"),
        meeting_notes: path.resolve(relativeRoot, "library/meeting-notes"),
        personal_ideas: path.resolve(relativeRoot, "library/personal-ideas"),
        reference_material: path.resolve(relativeRoot, "library/reference-material"),
      },
    });
  });

  it("creates the inbox and every category folder and is safe to call again", async () => {
    const root = path.join(await temporaryDirectory(), "new-library");

    const first = await ensureLibraryLayout(root);
    const second = await ensureLibraryLayout(root);

    expect(second).toEqual(first);
    for (const directory of [first.inbox, ...Object.values(first.categories)]) {
      await expect(stat(directory)).resolves.toMatchObject({});
      expect((await stat(directory)).isDirectory()).toBe(true);
    }
    await expect(readdir(path.join(first.root, "library"))).resolves.toEqual(
      expect.arrayContaining([
        "project-specs",
        "architecture-code",
        "meeting-notes",
        "personal-ideas",
        "reference-material",
      ]),
    );
  });
});
