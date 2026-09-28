/**
 * The xAI adapter.
 *
 * xAI speaks the OpenAI chat-completions protocol, so this reuses that adapter
 * against a different base URL and only relabels the reported provider.
 */
import OpenAI from "openai";
import { createOpenAIProvider, type ChatCompletionsPort } from "./openai.ts";
import type { ModelClient } from "./types.ts";

const XAI_BASE_URL = "https://api.x.ai/v1";

/** How an xAI client is constructed. Mirrors {@link OpenAIProviderOptions}. */
export type XaiProviderOptions = {
  apiKey: string;
  model: string;
  client?: ChatCompletionsPort;
};

/** Build an xAI-backed {@link ModelClient}. */
export function createXaiProvider(options: XaiProviderOptions): ModelClient {
  const client =
    options.client ??
    new OpenAI({
      apiKey: options.apiKey,
      baseURL: XAI_BASE_URL,
    });

  const inner = createOpenAIProvider({
    apiKey: options.apiKey,
    model: options.model,
    client,
  });

  return {
    provider: "xai",
    model: options.model,
    complete: (prompt) => inner.complete(prompt),
  };
}
