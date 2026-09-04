import { mkdir } from "node:fs/promises";
import path from "node:path";

export type Category = {
  id: string;
  name: string;
  definition: string;
  folder: string;
};

export const SEED_CATEGORIES = [
  {
    id: "project_specs",
    name: "Project Specs",
    definition: "Requirements, product briefs, roadmaps, and delivery plans.",
    folder: "project-specs",
  },
  {
    id: "architecture_code",
    name: "Architecture & Code",
    definition: "Technical designs, API definitions, system architecture, and code notes.",
    folder: "architecture-code",
  },
  {
    id: "meeting_notes",
    name: "Meeting Notes",
    definition: "Synchronous discussions, decisions, action items, and minutes.",
    folder: "meeting-notes",
  },
  {
    id: "personal_ideas",
    name: "Personal Ideas",
    definition: "Personal reflections, rough ideas, experiments, and creative notes.",
    folder: "personal-ideas",
  },
  {
    id: "reference_material",
    name: "Reference Material",
    definition: "External sources, research, links, guides, and material kept for later use.",
    folder: "reference-material",
  },
] as const satisfies readonly Category[];

export type SeedCategoryId = (typeof SEED_CATEGORIES)[number]["id"];

export const LOW_CONFIDENCE_FALLBACK: SeedCategoryId = "reference_material";
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export type LibraryPaths = {
  root: string;
  inbox: string;
  database: string;
  categories: Record<SeedCategoryId, string>;
};

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

export function isSeedCategoryId(value: string): value is SeedCategoryId {
  return SEED_CATEGORIES.some((category) => category.id === value);
}

export function getSeedCategory(id: SeedCategoryId): Category {
  return SEED_CATEGORIES.find((category) => category.id === id)!;
}
