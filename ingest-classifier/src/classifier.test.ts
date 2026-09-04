import { describe, expect, it, vi } from "vitest";
import type { ModelClient } from "./providers/types.ts";
import {
  buildClassificationPrompt,
  classifyFile,
  parseClassification,
} from "./classifier.ts";
import { SEED_CATEGORIES } from "./taxonomy.ts";

function modelClient(complete: ModelClient["complete"]): ModelClient {
  return {
    provider: "openai",
    model: "offline-test-model",
    complete,
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
  it("includes every fixed category, the note, and the required JSON contract", () => {
    const prompt = buildClassificationPrompt("The original note body.");

    for (const { id, name, definition } of SEED_CATEGORIES) {
      expect(prompt).toContain(`${id} (${name}): ${definition}`);
    }
    expect(prompt).toContain(
      '{"category":"seed_id","summary":"one or two sentences","tags":["tag"],"confidence_score":0.0}',
    );
    expect(prompt).toContain("Note:\nThe original note body.");
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
    ["an invented category", reply({ category: "new_category" }), /seed category id/],
    ["a blank summary", reply({ summary: "   " }), /non-empty string/],
    ["non-array tags", reply({ tags: "planning" }), /array of non-empty strings/],
    ["blank tags", reply({ tags: ["planning", ""] }), /array of non-empty strings/],
    ["non-numeric confidence", reply({ confidence_score: "0.9" }), /between 0 and 1/],
    ["negative confidence", reply({ confidence_score: -0.01 }), /between 0 and 1/],
    ["confidence above one", reply({ confidence_score: 1.01 }), /between 0 and 1/],
    ["non-finite confidence", reply({ confidence_score: Number.NaN }), /between 0 and 1/],
  ])("rejects %s", (_name, raw, expectedError) => {
    expect(() => parseClassification(raw)).toThrow(expectedError);
  });

  it("accepts empty tags and both confidence endpoints", () => {
    expect(parseClassification(reply({ tags: [], confidence_score: 0 }))).toEqual(
      expect.objectContaining({ tags: [], confidence_score: 0 }),
    );
    expect(parseClassification(reply({ confidence_score: 1 }))).toEqual(
      expect.objectContaining({ confidence_score: 1 }),
    );
  });
});

describe("classifyFile", () => {
  it("classifies through an injected client without making a network request", async () => {
    const complete = vi.fn<ModelClient["complete"]>(async (_prompt: string) =>
      reply({ category: "meeting_notes", confidence_score: 0.88 }),
    );

    await expect(classifyFile(modelClient(complete), "Meeting action items")).resolves.toEqual({
      category: "meeting_notes",
      summary: "A concise project plan.",
      tags: ["planning"],
      confidence_score: 0.88,
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0]).toContain("Meeting action items");
  });

  it("retries once after a malformed response and returns the valid retry", async () => {
    const complete = vi
      .fn<ModelClient["complete"]>()
      .mockResolvedValueOnce("not-json")
      .mockResolvedValueOnce(reply({ category: "personal_ideas" }));

    await expect(classifyFile(modelClient(complete), "An experiment")).resolves.toEqual(
      expect.objectContaining({ category: "personal_ideas" }),
    );
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("reports failure after both schema-validation attempts are exhausted", async () => {
    const complete = vi
      .fn<ModelClient["complete"]>()
      .mockResolvedValue(reply({ category: "invented" }));

    await expect(classifyFile(modelClient(complete), "Ambiguous note")).rejects.toThrow(
      /classification failed schema validation after 2 attempts: category must be a seed category id/,
    );
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("uses the configured attempt count for client errors", async () => {
    const complete = vi
      .fn<ModelClient["complete"]>()
      .mockRejectedValue(new Error("provider unavailable"));

    await expect(
      classifyFile(modelClient(complete), "Note", { maxAttempts: 1 }),
    ).rejects.toThrow(
      /classification failed schema validation after 1 attempts: provider unavailable/,
    );
    expect(complete).toHaveBeenCalledOnce();
  });

  it("routes confidence below 0.50 to reference material and preserves the request", async () => {
    const complete = vi.fn(async () =>
      reply({ category: "project_specs", confidence_score: 0.49 }),
    );

    await expect(classifyFile(modelClient(complete), "Unclear note")).resolves.toEqual({
      category: "reference_material",
      requested_category: "project_specs",
      summary: "A concise project plan.",
      tags: ["planning"],
      confidence_score: 0.49,
    });
  });

  it("keeps the requested category at the exact confidence boundary", async () => {
    const complete = vi.fn(async () => reply({ confidence_score: 0.5 }));

    await expect(classifyFile(modelClient(complete), "Boundary note")).resolves.toEqual({
      category: "project_specs",
      summary: "A concise project plan.",
      tags: ["planning"],
      confidence_score: 0.5,
    });
  });
});
