import OpenAI from "openai";
import type { ModelClient } from "./types.ts";

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

export function createOpenAIProvider(opts: {
  apiKey: string;
  model: string;
  client?: ChatCompletionsPort;
}): ModelClient {
  const client = opts.client ?? new OpenAI({ apiKey: opts.apiKey });

  return {
    provider: "openai",
    model: opts.model,
    async complete(prompt: string) {
      const response = await client.chat.completions.create({
        model: opts.model,
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
