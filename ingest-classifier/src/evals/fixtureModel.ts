import type { ModelClient } from "../providers/types.ts";

type Rule = {
  terms: string[];
  category: string;
  tags: string[];
};

const RULES: Rule[] = [
  { terms: ["meeting", "attendees", "action item", "minutes"], category: "meeting_notes", tags: ["meeting"] },
  { terms: ["api", "architecture", "database", "typescript", "cache", "code"], category: "architecture_code", tags: ["engineering"] },
  { terms: ["spec", "requirement", "roadmap", "launch", "acceptance"], category: "project_specs", tags: ["planning"] },
  { terms: ["idea", "journal", "reflection", "experiment"], category: "personal_ideas", tags: ["ideas"] },
];

export class FixtureModelClient implements ModelClient {
  readonly provider = "openai" as const;
  readonly model = "offline-fixture-model";

  async complete(prompt: string): Promise<string> {
    const noteMarker = "\nNote:\n";
    const noteStart = prompt.lastIndexOf(noteMarker);
    const normalized = (noteStart >= 0 ? prompt.slice(noteStart + noteMarker.length) : prompt)
      .toLowerCase();
    const rule = RULES.find(({ terms }) => terms.some((term) => normalized.includes(term)));
    const category = rule?.category ?? "reference_material";
    return JSON.stringify({
      category,
      summary: `Offline fixture summary for ${category}.`,
      tags: rule?.tags ?? ["reference"],
      confidence_score: rule ? 0.93 : 0.72,
    });
  }
}
