import type { ModelClient } from "../providers/types.ts";

type Existing = { id: string; terms: string[]; tags: string[] };

const SEED_RULES: Existing[] = [
  { id: "meeting_notes", terms: ["meeting", "attendees", "minutes"], tags: ["meeting"] },
  { id: "architecture_code", terms: ["api", "architecture", "database", "cache", "code"], tags: ["engineering"] },
  { id: "project_specs", terms: ["requirement", "roadmap", "launch", "acceptance"], tags: ["planning"] },
  { id: "personal_ideas", terms: ["idea", "journal", "reflection", "experiment"], tags: ["ideas"] },
];

export class AdaptiveFixtureModelClient implements ModelClient {
  readonly provider = "openai" as const;
  readonly model = "offline-adaptive-fixture-model";

  async complete(prompt: string): Promise<string> {
    const note = extractNote(prompt).toLowerCase();
    if (note.includes("dedup candidate")) {
      return proposed(
        "Architecture and Code",
        "Technical designs, API definitions, system architecture, and code notes.",
        ["engineering"],
      );
    }
    if (note.includes("bicycle") || note.includes("bike")) {
      return hasCategory(prompt, "equipment_maintenance")
        ? existing("equipment_maintenance", ["maintenance"])
        : proposed(
            "Equipment Maintenance",
            "Guides and notes about maintaining and repairing bicycles and equipment.",
            ["maintenance"],
          );
    }
    if (note.includes("recipe") || note.includes("cooking")) {
      return hasCategory(prompt, "recipes_cooking")
        ? existing("recipes_cooking", ["cooking"])
        : proposed(
            "Recipes Cooking",
            "Recipes, cooking techniques, ingredients, and meal preparation notes.",
            ["cooking"],
          );
    }
    const rule = SEED_RULES.find(({ terms }) => terms.some((term) => note.includes(term)));
    return existing(rule?.id ?? "reference_material", rule?.tags ?? ["reference"]);
  }
}

function extractNote(prompt: string): string {
  const marker = "\nNote:\n";
  const index = prompt.lastIndexOf(marker);
  return index >= 0 ? prompt.slice(index + marker.length) : prompt;
}

function hasCategory(prompt: string, id: string): boolean {
  return prompt.includes(`- ${id} (`);
}

function existing(category: string, tags: string[]): string {
  return JSON.stringify({
    action: "existing",
    category,
    summary: `Offline fixture summary for ${category}.`,
    tags,
    confidence_score: 0.94,
    fit_score: 0.92,
  });
}

function proposed(name: string, definition: string, tags: string[]): string {
  return JSON.stringify({
    action: "propose",
    proposal: { name, definition },
    summary: `Offline fixture summary for ${name}.`,
    tags,
    confidence_score: 0.9,
    fit_score: 0.35,
  });
}
