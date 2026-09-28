/**
 * The OpenAI adapter, also reused by xAI over a different base URL.
 */
import OpenAI from "openai";
import type { ModelClient } from "./types.ts";

/** The slice of the OpenAI SDK this adapter uses, so tests can substitute it. */
export type ChatCompletionsPort = {
  chat: {
    completions: {
      create: (body: {
        model: string;
        messages: Array<{ role: "user"; content: string }>;
      }) => Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
      }>;
    };
  };
};

/** How an OpenAI-compatible client is constructed. */
export type OpenAIProviderOptions = {
  apiKey: string;
  model: string;
  client?: ChatCompletionsPort;
};

/** Build an OpenAI-backed {@link ModelClient}. */
export function createOpenAIProvider(
  options: OpenAIProviderOptions,
): ModelClient {
  const client = options.client ?? new OpenAI({ apiKey: options.apiKey });

  return {
    provider: "openai",
    model: options.model,
    async complete(prompt: string) {
      const response = await client.chat.completions.create({
        model: options.model,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.choices[0]?.message?.content?.trim();
      if (!text) {
        throw new Error("openai returned an empty completion");
      }
      return text;
    },
  };
}
