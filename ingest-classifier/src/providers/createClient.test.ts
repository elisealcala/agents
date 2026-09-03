import { describe, expect, it, vi } from "vitest";
import { createModelClient } from "./createClient.ts";
import type { ModelClient } from "./types.ts";
import type { ModelConfig } from "../config.ts";

function fakeClient(provider: ModelClient["provider"]): ModelClient {
  return {
    provider,
    model: "test-model",
    complete: vi.fn(async () => `${provider}:ok`),
  };
}

const config = (provider: ModelConfig["provider"]): ModelConfig => ({
  provider,
  model: "test-model",
  apiKey: "test-key",
});

describe("createModelClient", () => {
  it("routes openai, anthropic, and xai to the matching factory", () => {
    const openai = vi.fn(() => fakeClient("openai"));
    const anthropic = vi.fn(() => fakeClient("anthropic"));
    const xai = vi.fn(() => fakeClient("xai"));
    const factories = { openai, anthropic, xai };

    expect(createModelClient(config("openai"), factories).provider).toBe(
      "openai",
    );
    expect(openai).toHaveBeenCalledWith({
      apiKey: "test-key",
      model: "test-model",
    });

    expect(createModelClient(config("anthropic"), factories).provider).toBe(
      "anthropic",
    );
    expect(createModelClient(config("xai"), factories).provider).toBe("xai");
    expect(xai).toHaveBeenCalledOnce();
  });
});
