import { describe, expect, it } from "vitest";
import type { ModelClient, ToolRunInput } from "../providers/types.ts";
import { placeNote, type TaxonomyEntry } from "./organizer.ts";

const ROOTS: TaxonomyEntry[] = [
  {
    id: "personal_ideas",
    name: "Personal Ideas",
    definition: "Journals and experiments.",
    parentId: null,
  },
  {
    id: "architecture_code",
    name: "Architecture & Code",
    definition: "Technical notes.",
    parentId: null,
  },
];

const CHILD: TaxonomyEntry = {
  id: "equipment_maintenance",
  name: "Equipment Maintenance",
  definition: "Repair notes.",
  parentId: "personal_ideas",
};

function client(runTools: ModelClient["runTools"]): ModelClient {
  return {
    provider: "anthropic",
    model: "offline-organizer",
    complete: async () => {
      throw new Error("unused");
    },
    runTools,
  };
}

const placement = {
  category: "architecture_code",
  summary: "A cache note.",
  tags: ["cache"],
  confidence_score: 0.9,
};

describe("placeNote", () => {
  it("lists one category's children and similar notes before filing", async () => {
    const seen: string[] = [];
    const runTools = async ({ execute }: ToolRunInput) => {
      const children = await execute("list_categories", {
        parent_id: "personal_ideas",
      });
      seen.push(children.content);
      const missing = await execute("list_categories", {
        parent_id: "missing",
      });
      expect(missing.isError).toBe(true);
      expect(missing.content).toContain("unknown category missing");
      const recent = await execute("list_recent_filings", {});
      expect(recent.content).toContain("just-filed.md");
      const recentArgs = await execute("list_recent_filings", {
        query: "wander",
      });
      expect(recentArgs.isError).toBe(true);
      const similar = await execute("search_similar_notes", {});
      seen.push(similar.content);
      const argued = await execute("search_similar_notes", { query: "wander" });
      expect(argued.isError).toBe(true);
      const proposed = await execute("propose_child", {
        parent: "personal_ideas",
      });
      expect(proposed.isError).toBe(true);
      const outcome = await execute("file_existing", placement);
      if (!outcome.terminal) throw new Error(outcome.content);
    };

    await expect(
      placeNote(client(runTools), {
        system: "Organize.",
        user: "Cache TTL notes.",
        entries: [...ROOTS, CHILD],
        allowPropose: false,
        listRecent: async () => [
          {
            path: "/library/meeting-notes/just-filed.md",
            categoryId: "meeting_notes",
            summary: "A meeting that just landed.",
            filedAt: "2026-10-01 16:00:00",
          },
        ],
        searchSimilar: async () => [
          {
            path: "/library/architecture-code/cache.md",
            categoryId: "architecture_code",
            summary: "Cache policy.",
            snippet: "Use explicit TTLs.",
          },
        ],
        acceptExisting: () => placement,
      }),
    ).resolves.toEqual(placement);

    expect(seen[0]).toContain("personal_ideas (Personal Ideas)");
    expect(seen[0]).toContain("equipment_maintenance (Equipment Maintenance)");
    expect(seen[0]).not.toContain("architecture_code (Architecture & Code)");
    expect(seen[1]).toContain("/library/architecture-code/cache.md");
    expect(seen[1]).toContain("Use explicit TTLs.");
  });
});
