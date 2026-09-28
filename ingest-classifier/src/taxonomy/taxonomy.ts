/**
 * The fixed starting taxonomy and the on-disk shape of a library.
 *
 * The five seeds are the only categories that exist before any note is filed.
 * They always stay roots: adaptive classification nests new categories beneath
 * them but never above or beside them (DEC-019).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

/** A category's identity and its folder name under `library/`. */
export type Category = {
  id: string;
  name: string;
  definition: string;
  folder: string;
};

/**
 * The seed category ids, written out rather than inferred.
 *
 * Spelling the union here keeps it readable at a glance and lets
 * {@link SEED_CATEGORIES} carry an explicit type. Adding a seed means editing
 * both this union and the array below.
 */
export type SeedCategoryId =
  | "project_specs"
  | "architecture_code"
  | "meeting_notes"
  | "personal_ideas"
  | "reference_material";

/** A seed category: a {@link Category} whose id is one of the fixed five. */
export type SeedCategory = Category & { id: SeedCategoryId };

/** The five roots every library starts with. Order fixes folder creation. */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  {
    id: "project_specs",
    name: "Project Specs",
    definition: "Requirements, product briefs, roadmaps, and delivery plans.",
    folder: "project-specs",
  },
  {
    id: "architecture_code",
    name: "Architecture & Code",
    definition:
      "Technical designs, API definitions, system architecture, and code notes.",
    folder: "architecture-code",
  },
  {
    id: "meeting_notes",
    name: "Meeting Notes",
    definition:
      "Synchronous discussions, decisions, action items, and minutes.",
    folder: "meeting-notes",
  },
  {
    id: "personal_ideas",
    name: "Personal Ideas",
    definition:
      "Personal reflections, rough ideas, experiments, and creative notes.",
    folder: "personal-ideas",
  },
  {
    id: "reference_material",
    name: "Reference Material",
    definition:
      "External sources, research, links, guides, and material kept for later use.",
    folder: "reference-material",
  },
];

export const LOW_CONFIDENCE_FALLBACK: SeedCategoryId = "reference_material";
/**
 * Below this confidence the fixed-taxonomy pipeline files a note under
 * {@link LOW_CONFIDENCE_FALLBACK} rather than guessing (DEC-004).
 *
 * This threshold belongs to the M1 pipeline only. Adaptive classification
 * judges category fit instead — see `EXISTING_CATEGORY_FIT_THRESHOLD`.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Every path the classifier reads or writes, derived from one root. */
export type LibraryPaths = {
  root: string;
  inbox: string;
  database: string;
  categories: Record<SeedCategoryId, string>;
};

/** Resolve a library's paths. Creates nothing; see {@link ensureLibraryLayout}. */
export function getLibraryPaths(root: string): LibraryPaths {
  const absoluteRoot = path.resolve(root);
  return {
    root: absoluteRoot,
    inbox: path.join(absoluteRoot, "inbox"),
    database: path.join(absoluteRoot, "ingest-classifier.sqlite"),
    categories: Object.fromEntries(
      SEED_CATEGORIES.map((category) => [
        category.id,
        path.join(absoluteRoot, "library", category.folder),
      ]),
    ) as Record<SeedCategoryId, string>,
  };
}

/** Create the inbox and the five seed folders. Safe to call repeatedly. */
export async function ensureLibraryLayout(root: string): Promise<LibraryPaths> {
  const paths = getLibraryPaths(root);
  await Promise.all([
    mkdir(paths.inbox, { recursive: true }),
    ...Object.values(paths.categories).map((folder) =>
      mkdir(folder, { recursive: true }),
    ),
  ]);
  return paths;
}

/** Narrow an arbitrary string to a seed id. */
export function isSeedCategoryId(value: string): value is SeedCategoryId {
  return SEED_CATEGORIES.some((category) => category.id === value);
}

/** Look up a seed. The assertion holds because the id type is closed. */
export function getSeedCategory(id: SeedCategoryId): Category {
  return SEED_CATEGORIES.find((category) => category.id === id)!;
}
