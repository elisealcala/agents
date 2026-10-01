/**
 * A deterministic stand-in for the organizer, for the fixed-taxonomy evaluation.
 *
 * Reads the note and calls file_existing once, which keeps the evaluation
 * offline, fast, and reproducible.
 */
import type { ModelClient, ToolRunInput } from "../src/providers/types.ts";

type Rule = {
  terms: string[];
  category: string;
  tags: string[];
};

const RULES: Rule[] = [
  {
    terms: ["meeting", "attendees", "action item", "minutes"],
    category: "meeting_notes",
    tags: ["meeting"],
  },
  {
    terms: ["api", "architecture", "database", "typescript", "cache", "code"],
    category: "architecture_code",
    tags: ["engineering"],
  },
  {
    terms: ["spec", "requirement", "roadmap", "launch", "acceptance"],
    category: "project_specs",
    tags: ["planning"],
  },
  {
    terms: ["idea", "journal", "reflection", "experiment"],
    category: "personal_ideas",
    tags: ["ideas"],
  },
];

export class FixtureModelClient implements ModelClient {
  readonly provider = "anthropic" as const;
  readonly model = "offline-fixture-model";

  async complete(): Promise<string> {
    throw new Error("fixed fixture does not answer questions");
  }

  async runTools(input: ToolRunInput): Promise<void> {
    const note = input.user.toLowerCase();
    const rule = RULES.find(({ terms }) =>
      terms.some((term) => note.includes(term)),
    );
    const category = rule?.category ?? "reference_material";
    const outcome = await input.execute("file_existing", {
      category,
      summary: `Offline fixture summary for ${category}.`,
      tags: rule?.tags ?? ["reference"],
      confidence_score: rule ? 0.93 : 0.72,
    });
    if (!outcome.terminal) throw new Error(outcome.content);
  }
}
