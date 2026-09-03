import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("loads openai when provider, model, and key are set", () => {
    expect(
      loadConfig({
        INGEST_PROVIDER: "openai",
        INGEST_MODEL: "gpt-4.1",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toEqual({
      provider: "openai",
      model: "gpt-4.1",
      apiKey: "sk-test",
    });
  });

  it("loads anthropic and xai keys for those providers", () => {
    expect(
      loadConfig({
        INGEST_PROVIDER: "anthropic",
        INGEST_MODEL: "claude-sonnet-4-20250514",
        ANTHROPIC_API_KEY: "ant-test",
      }).apiKey,
    ).toBe("ant-test");

    expect(
      loadConfig({
        INGEST_PROVIDER: "xai",
        INGEST_MODEL: "grok-4",
        XAI_API_KEY: "xai-test",
      }).provider,
    ).toBe("xai");
  });

  it("throws when provider is missing", () => {
    expect(() =>
      loadConfig({ INGEST_MODEL: "gpt-4.1", OPENAI_API_KEY: "sk-test" }),
    ).toThrow(/INGEST_PROVIDER is required/);
  });

  it("throws on unknown provider", () => {
    expect(() =>
      loadConfig({
        INGEST_PROVIDER: "cursor",
        INGEST_MODEL: "composer",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toThrow(/Unknown INGEST_PROVIDER "cursor"/);
  });

  it("throws when model is missing", () => {
    expect(() =>
      loadConfig({ INGEST_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" }),
    ).toThrow(/INGEST_MODEL is required/);
  });

  it("throws when the matching API key is missing", () => {
    expect(() =>
      loadConfig({
        INGEST_PROVIDER: "openai",
        INGEST_MODEL: "gpt-4.1",
        ANTHROPIC_API_KEY: "wrong-key",
      }),
    ).toThrow(/OPENAI_API_KEY is required/);
  });
});
