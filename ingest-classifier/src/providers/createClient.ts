import { loadConfig, type ModelConfig } from "../config.ts";
import { createAnthropicProvider } from "./anthropic.ts";
import { createOpenAIProvider } from "./openai.ts";
import { createXaiProvider } from "./xai.ts";
import type { ModelClient } from "./types.ts";

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

export function createModelClient(
  config: ModelConfig = loadConfig(),
  factories: ProviderFactories = defaultFactories,
): ModelClient {
  return factories[config.provider]({
    apiKey: config.apiKey,
    model: config.model,
  });
}
