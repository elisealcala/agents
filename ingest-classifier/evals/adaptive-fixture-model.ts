/**
 * A deterministic stand-in for the organizer, for the adaptive evaluations.
 *
 * Looks up the live taxonomy, then calls one terminal tool, so nesting and
 * dedup can be exercised offline and reproducibly.
 */
import type {
  CompletionInput,
  ModelClient,
  ToolRunInput,
} from "../src/providers/types.ts";

type Existing = { id: string; terms: string[]; tags: string[] };

const SEED_RULES: Existing[] = [
  {
    id: "meeting_notes",
    terms: ["meeting", "attendees", "minutes"],
    tags: ["meeting"],
  },
  {
    id: "architecture_code",
    terms: ["api", "architecture", "database", "cache", "code"],
    tags: ["engineering"],
  },
  {
    id: "project_specs",
    terms: ["requirement", "roadmap", "launch", "acceptance"],
    tags: ["planning"],
  },
  {
    id: "personal_ideas",
    terms: ["idea", "journal", "reflection", "experiment"],
    tags: ["ideas"],
  },
];

const GROUNDED_ANSWER =
  "The grounded notes emphasize measuring cache hit rate, choosing explicit TTLs, and rehearsing invalidation before rollout.";

export class AdaptiveFixtureModelClient implements ModelClient {
  readonly provider = "anthropic" as const;
  readonly model = "offline-adaptive-fixture-model";

  async complete(input: CompletionInput): Promise<string> {
    const text = `${input.system}\n${input.user}`;
    if (text.includes("Grounded excerpts:")) return GROUNDED_ANSWER;
    throw new Error("adaptive fixture complete is only for grounded answers");
  }

  async runTools(input: ToolRunInput): Promise<void> {
    const listed = await input.execute("list_categories", {});
    if (listed.isError) throw new Error(listed.content);
    const outcome = await input.execute(
      ...decision(input.user.toLowerCase(), listed.content),
    );
    if (!outcome.terminal) throw new Error(outcome.content);
  }
}

function decision(
  note: string,
  taxonomy: string,
): ["file_existing" | "propose_child", Record<string, unknown>] {
  if (note.includes("dedup candidate")) {
    return ["file_existing", existing("architecture_code", ["engineering"])];
  }
  if (note.includes("bicycle") || note.includes("bike")) {
    return hasCategory(taxonomy, "equipment_maintenance")
      ? ["file_existing", existing("equipment_maintenance", ["maintenance"])]
      : [
          "propose_child",
          proposed(
            "personal_ideas",
            "Equipment Maintenance",
            "Guides and notes about maintaining and repairing bicycles and equipment.",
            ["maintenance"],
          ),
        ];
  }
  if (note.includes("recipe") || note.includes("cooking")) {
    return hasCategory(taxonomy, "recipes_cooking")
      ? ["file_existing", existing("recipes_cooking", ["cooking"])]
      : [
          "propose_child",
          proposed(
            "personal_ideas",
            "Recipes Cooking",
            "Recipes, cooking techniques, ingredients, and meal preparation notes.",
            ["cooking"],
          ),
        ];
  }
  const rule = SEED_RULES.find(({ terms }) =>
    terms.some((term) => note.includes(term)),
  );
  return [
    "file_existing",
    existing(rule?.id ?? "reference_material", rule?.tags ?? ["reference"]),
  ];
}

function hasCategory(taxonomy: string, id: string): boolean {
  return taxonomy.includes(`- ${id} (`);
}

function existing(category: string, tags: string[]): Record<string, unknown> {
  return {
    category,
    summary: `Offline fixture summary for ${category}.`,
    tags,
    confidence_score: 0.94,
    fit_score: 0.92,
  };
}

function proposed(
  parent: string,
  name: string,
  definition: string,
  tags: string[],
): Record<string, unknown> {
  return {
    parent,
    name,
    definition,
    summary: `Offline fixture summary for ${name}.`,
    tags,
    confidence_score: 0.9,
    fit_score: 0.35,
  };
}
