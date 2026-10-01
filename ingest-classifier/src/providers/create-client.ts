/**
 * The one place that turns configuration into an Anthropic client (DEC-025).
 */
import { loadConfig, type ModelConfig } from "../config.ts";
import {
  createAnthropicProvider,
  type AnthropicProviderOptions,
} from "./anthropic.ts";
import type { ModelClient } from "./types.ts";

/** Build the Anthropic client named by configuration. */
export function createModelClient(
  config: ModelConfig = loadConfig(),
  createProvider: (
    options: AnthropicProviderOptions,
  ) => ModelClient = createAnthropicProvider,
): ModelClient {
  return createProvider({
    apiKey: config.apiKey,
    model: config.model,
  });
}
