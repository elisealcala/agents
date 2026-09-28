/**
 * Provider selection: the one place that turns configuration into a client.
 *
 * Factories are injectable so tests and offline evaluations can supply a
 * deterministic client without touching the real SDKs.
 */
import { loadConfig, type ModelConfig } from "../config.ts";
import { createAnthropicProvider } from "./anthropic.ts";
import { createOpenAIProvider } from "./openai.ts";
import { createXaiProvider } from "./xai.ts";
import type { ModelClient } from "./types.ts";

/** One builder per supported provider (DEC-002). */
export type ProviderFactories = {
  openai: typeof createOpenAIProvider;
  anthropic: typeof createAnthropicProvider;
  xai: typeof createXaiProvider;
};

const defaultFactories: ProviderFactories = {
  openai: createOpenAIProvider,
  anthropic: createAnthropicProvider,
  xai: createXaiProvider,
};

/** Build the client the configured provider calls for. */
export function createModelClient(
  config: ModelConfig = loadConfig(),
  factories: ProviderFactories = defaultFactories,
): ModelClient {
  return factories[config.provider]({
    apiKey: config.apiKey,
    model: config.model,
  });
}
