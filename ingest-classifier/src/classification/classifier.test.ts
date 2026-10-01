import { describe, expect, it, vi } from "vitest";
import type { ModelClient } from "../providers/types.ts";
import {
  buildClassificationPrompt,
  classifyFile,
  parseClassification,
} from "./classifier.ts";

function modelClient(runTools: ModelClient["runTools"]): ModelClient {
  return {
    provider: "anthropic",
    model: "offline-test-model",
    complete: async () => {
      throw new Error("fixed classification does not answer questions");
    },
    runTools,
  };
}

function fileExisting(
  fields: Record<string, unknown>,
): ModelClient["runTools"] {
  return async ({ execute }) => {
    const outcome = await execute("file_existing", fields);
    if (!outcome.terminal) throw new Error(outcome.content);
  };
}

function reply(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    category: "project_specs",
    summary: "A concise project plan.",
    tags: ["planning"],
    confidence_score: 0.9,
    ...overrides,
  });
}

describe("buildClassificationPrompt", () => {
  it("tells the organizer to look up the seeds and file once", () => {
    const prompt = buildClassificationPrompt();

    expect(prompt).toContain("list_categories");
    expect(prompt).toContain("search_similar_notes");
    expect(prompt).toContain("file_existing");
    expect(prompt).not.toContain("propose_child");
    expect(prompt).not.toContain("Note:");
  });
});

describe("parseClassification", () => {
  it("parses fenced JSON, trims text fields, and removes duplicate tags", () => {
    expect(
      parseClassification(
        `\`\`\`json
${reply({
  category: "architecture_code",
  summary: "  API boundary notes.  ",
  tags: [" api ", "design", "api"],
  confidence_score: 1,
})}
\`\`\``,
      ),
    ).toEqual({
      category: "architecture_code",
      summary: "API boundary notes.",
      tags: ["api", "design"],
      confidence_score: 1,
    });
  });

  it.each([
    ["malformed JSON", "not json", /not valid JSON/],
    ["a JSON primitive", "null", /must be a JSON object/],
    ["a JSON array", "[]", /must be a JSON object/],
    ["a missing category", reply({ category: undefined }), /seed category id/],
    [
      "an invented category",
      reply({ category: "new_category" }),
      /seed category id/,
    ],
    ["a blank summary", reply({ summary: "   " }), /non-empty string/],
    [
      "non-array tags",
      reply({ tags: "planning" }),
      /array of non-empty strings/,
    ],
    [
      "blank tags",
      reply({ tags: ["planning", ""] }),
      /array of non-empty strings/,
    ],
    [
      "non-numeric confidence",
      reply({ confidence_score: "0.9" }),
      /between 0 and 1/,
    ],
    [
      "negative confidence",
      reply({ confidence_score: -0.01 }),
      /between 0 and 1/,
    ],
    [
      "confidence above one",
      reply({ confidence_score: 1.01 }),
      /between 0 and 1/,
    ],
    [
      "non-finite confidence",
      reply({ confidence_score: Number.NaN }),
      /between 0 and 1/,
    ],
  ])("rejects %s", (_name, raw, expectedError) => {
    expect(() => parseClassification(raw)).toThrow(expectedError);
  });

  it("accepts empty tags and both confidence endpoints", () => {
    expect(
      parseClassification(reply({ tags: [], confidence_score: 0 })),
    ).toEqual(expect.objectContaining({ tags: [], confidence_score: 0 }));
    expect(parseClassification(reply({ confidence_score: 1 }))).toEqual(
      expect.objectContaining({ confidence_score: 1 }),
    );
  });
});

describe("classifyFile", () => {
  it("classifies through an injected client without making a network request", async () => {
    const runTools = vi.fn<ModelClient["runTools"]>(
      async ({ user, execute }) => {
        expect(user).toBe("Meeting action items");
        const outcome = await execute(
          "file_existing",
          JSON.parse(
            reply({ category: "meeting_notes", confidence_score: 0.88 }),
          ),
        );
        if (!outcome.terminal) throw new Error(outcome.content);
      },
    );

    await expect(
      classifyFile(modelClient(runTools), "Meeting action items"),
    ).resolves.toEqual({
      category: "meeting_notes",
      summary: "A concise project plan.",
      tags: ["planning"],
      confidence_score: 0.88,
    });
    expect(runTools).toHaveBeenCalledOnce();
  });

  it("retries once after a rejected attempt and returns the valid retry", async () => {
    const runTools = vi
      .fn<ModelClient["runTools"]>()
      .mockRejectedValueOnce(new Error("not-json"))
      .mockImplementationOnce(
        fileExisting(JSON.parse(reply({ category: "personal_ideas" }))),
      );

    await expect(
      classifyFile(modelClient(runTools), "An experiment"),
    ).resolves.toEqual(expect.objectContaining({ category: "personal_ideas" }));
    expect(runTools).toHaveBeenCalledTimes(2);
  });

  it("reports failure after both schema-validation attempts are exhausted", async () => {
    const runTools = vi.fn<ModelClient["runTools"]>(async ({ execute }) => {
      const outcome = await execute(
        "file_existing",
        JSON.parse(reply({ category: "invented" })),
      );
      if (!outcome.terminal) throw new Error(outcome.content);
    });

    await expect(
      classifyFile(modelClient(runTools), "Ambiguous note"),
    ).rejects.toThrow(
      /classification failed schema validation after 2 attempts: category must be a seed category id/,
    );
    expect(runTools).toHaveBeenCalledTimes(2);
  });

  it("uses the configured attempt count for client errors", async () => {
    const runTools = vi
      .fn<ModelClient["runTools"]>()
      .mockRejectedValue(new Error("provider unavailable"));

    await expect(
      classifyFile(modelClient(runTools), "Note", { maxAttempts: 1 }),
    ).rejects.toThrow(
      /classification failed schema validation after 1 attempts: provider unavailable/,
    );
    expect(runTools).toHaveBeenCalledOnce();
  });

  it("routes confidence below 0.50 to reference material and preserves the request", async () => {
    const runTools = vi.fn(
      fileExisting(
        JSON.parse(
          reply({ category: "project_specs", confidence_score: 0.49 }),
        ),
      ),
    );

    await expect(
      classifyFile(modelClient(runTools), "Unclear note"),
    ).resolves.toEqual({
      category: "reference_material",
      requested_category: "project_specs",
      summary: "A concise project plan.",
      tags: ["planning"],
      confidence_score: 0.49,
    });
  });

  it("keeps the requested category at the exact confidence boundary", async () => {
    const runTools = vi.fn(
      fileExisting(JSON.parse(reply({ confidence_score: 0.5 }))),
    );

    await expect(
      classifyFile(modelClient(runTools), "Boundary note"),
    ).resolves.toEqual({
      category: "project_specs",
      summary: "A concise project plan.",
      tags: ["planning"],
      confidence_score: 0.5,
    });
  });
});
