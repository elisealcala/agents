import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelClient } from "../providers/types.ts";
import {
  EXISTING_CATEGORY_FIT_THRESHOLD,
  adaptivePlacementHooks,
  buildAdaptiveClassificationPrompt,
  classifyWithLiveTaxonomy,
  parseAdaptiveClassification,
} from "./adaptive-classifier.ts";
import { CategoryStore, type StoredCategory } from "../storage/categories.ts";

const stores: CategoryStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // A test can close a store before reopening it.
    }
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function storedCategory(
  id: string,
  name: string,
  definition: string,
): StoredCategory {
  return {
    id,
    name,
    definition,
    folder: id.replaceAll("_", "-"),
    parentId: null,
    embedding: null,
    embeddingProvider: null,
    isSeed: true,
    createdAt: "2026-09-04 00:00:00",
  };
}

const LIVE_CATEGORIES = [
  storedCategory(
    "project_specs",
    "Project Specs",
    "Product plans and requirements.",
  ),
  storedCategory(
    "meeting_notes",
    "Meeting Notes",
    "Meeting minutes and decisions.",
  ),
];

function existing(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: "existing",
    category: "project_specs",
    summary: "A product requirement.",
    tags: ["planning"],
    confidence_score: 0.9,
    fit_score: 0.9,
    ...overrides,
  });
}

function proposed(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: "propose",
    parent: "project_specs",
    proposal: {
      name: "Equipment Maintenance",
      definition: "Repair and maintenance notes for equipment.",
    },
    summary: "A bicycle repair guide.",
    tags: ["repair"],
    confidence_score: 0.9,
    fit_score: 0.4,
    ...overrides,
  });
}

function client(runTools: ModelClient["runTools"]): ModelClient {
  return {
    provider: "anthropic",
    model: "offline-adaptive-model",
    complete: async () => {
      throw new Error("adaptive classification does not answer questions");
    },
    runTools,
  };
}

function place(
  name: string,
  input: Record<string, unknown>,
): ModelClient["runTools"] {
  return async ({ execute }) => {
    const outcome = await execute(name, input);
    if (!outcome.terminal) throw new Error(outcome.content);
  };
}

describe("live taxonomy prompt", () => {
  it("builds the model prompt from persisted categories and current corrections", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "adaptive-classifier-test-"),
    );
    temporaryDirectories.push(root);
    const store = new CategoryStore(path.join(root, "audit.sqlite"), root);
    stores.push(store);
    await store.initialize();
    const created = await store.create(
      {
        name: "Customer Interviews",
        definition: "Research calls and customer discovery notes.",
      },
      [1, 0],
      "fixture-v1",
    );
    const runTools = vi.fn<ModelClient["runTools"]>(
      async ({ system, user, execute }) => {
        const listed = await execute("list_categories", {});
        expect(listed.content).toContain(
          "customer_interviews (Customer Interviews): Research calls and customer discovery notes.",
        );
        expect(system).toContain(
          "Corrections to learn from:\n- Discovery calls belong in Customer Interviews.",
        );
        expect(user).toBe("A discovery call with a customer.");
        expect(system).not.toContain(user);
        const outcome = await execute(
          "file_existing",
          JSON.parse(existing({ category: created.id, fit_score: 0.81 })),
        );
        if (!outcome.terminal) throw new Error(outcome.content);
      },
    );

    const result = await classifyWithLiveTaxonomy(
      client(runTools),
      "A discovery call with a customer.",
      store.list(),
      { examples: ["Discovery calls belong in Customer Interviews."] },
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: "existing",
        category: "customer_interviews",
        fit_score: 0.81,
      }),
    );
  });

  it("keeps the system prompt free of the taxonomy and of corrections until some exist", () => {
    const prompt = buildAdaptiveClassificationPrompt();

    expect(prompt).toContain("fit_score > 0.80");
    expect(prompt).toContain("list_recent_filings");
    expect(prompt).toContain("propose_child");
    expect(prompt).not.toContain("project_specs (Project Specs)");
    expect(prompt).not.toContain("Corrections to learn from:");
  });

  it("lists only the categories supplied at call time", async () => {
    const seen: string[] = [];
    const runTools = vi.fn<ModelClient["runTools"]>(async ({ execute }) => {
      const listed = await execute("list_categories", {});
      seen.push(listed.content);
      const outcome = await execute(
        "file_existing",
        JSON.parse(
          existing({
            category: seen.length === 1 ? "project_specs" : "meeting_notes",
          }),
        ),
      );
      if (!outcome.terminal) throw new Error(outcome.content);
    });

    await classifyWithLiveTaxonomy(client(runTools), "Note", [
      LIVE_CATEGORIES[0]!,
    ]);
    await classifyWithLiveTaxonomy(client(runTools), "Note", [
      LIVE_CATEGORIES[1]!,
    ]);

    expect(seen[0]).toContain("project_specs (Project Specs)");
    expect(seen[0]).not.toContain("meeting_notes (Meeting Notes)");
    expect(seen[1]).toContain("meeting_notes (Meeting Notes)");
    expect(seen[1]).not.toContain("project_specs (Project Specs)");
  });
});

describe("parseAdaptiveClassification", () => {
  it("parses and normalizes a fenced existing-category response", () => {
    expect(
      parseAdaptiveClassification(
        `\`\`\`json
${existing({
  category: "meeting_notes",
  summary: "  Decisions from the weekly call.  ",
  tags: [" weekly ", "decision", "weekly"],
  confidence_score: 1,
  fit_score: 0.81,
})}
\`\`\``,
        LIVE_CATEGORIES,
      ),
    ).toEqual({
      action: "existing",
      category: "meeting_notes",
      summary: "Decisions from the weekly call.",
      tags: ["weekly", "decision"],
      confidence_score: 1,
      fit_score: 0.81,
    });
  });

  it("enforces the strict existing-category side of the 0.80 boundary", () => {
    expect(EXISTING_CATEGORY_FIT_THRESHOLD).toBe(0.8);
    expect(() =>
      parseAdaptiveClassification(
        existing({ fit_score: 0.8 }),
        LIVE_CATEGORIES,
      ),
    ).toThrow(/greater than 0.80/);
    expect(
      parseAdaptiveClassification(
        existing({ fit_score: 0.800001 }),
        LIVE_CATEGORIES,
      ),
    ).toEqual(
      expect.objectContaining({ action: "existing", fit_score: 0.800001 }),
    );
  });

  it("allows a child proposal when the parent fit is above 0.80", () => {
    expect(
      parseAdaptiveClassification(
        proposed({ fit_score: 0.91 }),
        LIVE_CATEGORIES,
      ),
    ).toEqual(
      expect.objectContaining({
        action: "propose",
        parent: "project_specs",
        fit_score: 0.91,
      }),
    );
  });

  it("trims a valid proposal and deduplicates its tags", () => {
    expect(
      parseAdaptiveClassification(
        proposed({
          proposal: {
            name: "  Recipes and Cooking  ",
            definition: "  Recipes, ingredients, and cooking techniques.  ",
          },
          tags: [" cooking ", "recipe", "cooking"],
          fit_score: 0,
        }),
        LIVE_CATEGORIES,
      ),
    ).toEqual({
      action: "propose",
      parent: "project_specs",
      proposal: {
        name: "Recipes and Cooking",
        definition: "Recipes, ingredients, and cooking techniques.",
      },
      summary: "A bicycle repair guide.",
      tags: ["cooking", "recipe"],
      confidence_score: 0.9,
      fit_score: 0,
    });
  });

  it("rejects an existing id that is absent from the live taxonomy", () => {
    expect(() =>
      parseAdaptiveClassification(
        existing({ category: "stale_or_invented" }),
        LIVE_CATEGORIES,
      ),
    ).toThrow(/must be a live category id/);
  });

  it.each([
    ["malformed JSON", "not-json", /not valid JSON/],
    ["a JSON primitive", "null", /must be an object/],
    [
      "a blank summary",
      existing({ summary: "  " }),
      /summary must be a non-empty string/,
    ],
    ["non-array tags", existing({ tags: "planning" }), /tags must be an array/],
    [
      "a blank tag",
      existing({ tags: ["planning", ""] }),
      /tags must be an array/,
    ],
    [
      "low confidence",
      existing({ confidence_score: -0.1 }),
      /confidence_score/,
    ],
    [
      "high confidence",
      existing({ confidence_score: 1.1 }),
      /confidence_score/,
    ],
    ["non-numeric fit", existing({ fit_score: "0.9" }), /fit_score/],
    ["an unknown action", existing({ action: "reuse" }), /existing or propose/],
    [
      "a missing parent",
      proposed({ parent: "missing_parent" }),
      /proposal parent must be a live category id/,
    ],
    [
      "a missing proposal",
      proposed({ proposal: undefined }),
      /name and definition/,
    ],
    ["an array proposal", proposed({ proposal: [] }), /name and definition/],
    [
      "a blank proposal name",
      proposed({ proposal: { name: " ", definition: "Valid." } }),
      /proposal name must be non-empty/,
    ],
    [
      "a blank proposal definition",
      proposed({ proposal: { name: "Valid", definition: " " } }),
      /proposal definition must be non-empty/,
    ],
  ])("rejects %s", (_name, raw, error) => {
    expect(() => parseAdaptiveClassification(raw, LIVE_CATEGORIES)).toThrow(
      error,
    );
  });
});

describe("classifyWithLiveTaxonomy", () => {
  it("retries one invalid reply and returns the valid second reply", async () => {
    const runTools = vi
      .fn<ModelClient["runTools"]>()
      .mockRejectedValueOnce(new Error("not-json"))
      .mockImplementationOnce(
        place(
          "file_existing",
          JSON.parse(existing({ category: "meeting_notes" })),
        ),
      );

    await expect(
      classifyWithLiveTaxonomy(
        client(runTools),
        "Meeting minutes",
        LIVE_CATEGORIES,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "existing",
        category: "meeting_notes",
      }),
    );
    expect(runTools).toHaveBeenCalledTimes(2);
  });

  it("reports the final schema failure after attempts are exhausted", async () => {
    const runTools = vi.fn<ModelClient["runTools"]>(async ({ execute }) => {
      const outcome = await execute(
        "file_existing",
        JSON.parse(existing({ fit_score: 0.8 })),
      );
      if (!outcome.terminal) throw new Error(outcome.content);
    });

    await expect(
      classifyWithLiveTaxonomy(
        client(runTools),
        "Borderline note",
        LIVE_CATEGORIES,
      ),
    ).rejects.toThrow(
      /adaptive classification failed after 2 attempts: existing category fit_score must be greater than 0.80/,
    );
    expect(runTools).toHaveBeenCalledTimes(2);
  });

  it("honors a configured retry count for client errors", async () => {
    const runTools = vi
      .fn<ModelClient["runTools"]>()
      .mockRejectedValue(new Error("offline provider unavailable"));

    await expect(
      classifyWithLiveTaxonomy(client(runTools), "Note", LIVE_CATEGORIES, {
        maxAttempts: 1,
      }),
    ).rejects.toThrow(/failed after 1 attempts: offline provider unavailable/);
    expect(runTools).toHaveBeenCalledOnce();
  });
});

describe("adaptive placement hook", () => {
  it("denies a terminal tool the adaptive classifier rejects", async () => {
    const hooks = adaptivePlacementHooks(LIVE_CATEGORIES, 0.8);
    const hook = hooks.PreToolUse?.[0]?.hooks[0];
    const denied = await hook?.({
      hook_event_name: "PreToolUse",
      tool_name: "file_existing",
      tool_use_id: "tool-1",
      tool_input: JSON.parse(existing({ fit_score: 0.8 })),
    });

    expect(denied?.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(denied?.hookSpecificOutput?.permissionDecisionReason).toMatch(
      /greater than 0.80/,
    );
  });

  it("allows a placement the adaptive classifier accepts", async () => {
    const hooks = adaptivePlacementHooks(LIVE_CATEGORIES, 0.8);
    const hook = hooks.PreToolUse?.[0]?.hooks[0];
    const allowed = await hook?.({
      hook_event_name: "PreToolUse",
      tool_name: "propose_child",
      tool_use_id: "tool-2",
      tool_input: {
        parent: "project_specs",
        name: "Equipment Maintenance",
        definition: "Repair and maintenance notes for equipment.",
        summary: "A bicycle repair guide.",
        tags: ["repair"],
        confidence_score: 0.9,
        fit_score: 0.91,
      },
    });

    expect(allowed).toEqual({});
  });
});
