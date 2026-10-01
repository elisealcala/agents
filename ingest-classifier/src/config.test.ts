import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("loads the Anthropic model and key", () => {
    expect(
      loadConfig({
        INGEST_MODEL: "claude-sonnet-4-20250514",
        ANTHROPIC_API_KEY: "ant-test",
      }),
    ).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "ant-test",
    });
  });

  it("throws when the model is missing", () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: "ant-test" })).toThrow(
      /INGEST_MODEL is required/,
    );
  });

  it("throws when the API key is missing", () => {
    expect(() =>
      loadConfig({ INGEST_MODEL: "claude-sonnet-4-20250514" }),
    ).toThrow(/ANTHROPIC_API_KEY is required/);
  });
});
