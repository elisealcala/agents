import OpenAI from "openai";
import { createOpenAIProvider, type ChatCompletionsPort } from "./openai.ts";
import type { ModelClient } from "./types.ts";

const XAI_BASE_URL = "https://api.x.ai/v1";

export function createXaiProvider(opts: {
  apiKey: string;
  model: string;
  client?: ChatCompletionsPort;
}): ModelClient {
  const client =
    opts.client ??
    new OpenAI({
      apiKey: opts.apiKey,
      baseURL: XAI_BASE_URL,
    });

  const inner = createOpenAIProvider({
    apiKey: opts.apiKey,
    model: opts.model,
    client,
  });

  return {
    provider: "xai",
    model: opts.model,
    complete: (prompt) => inner.complete(prompt),
  };
}
