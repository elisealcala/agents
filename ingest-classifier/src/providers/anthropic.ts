import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "./types.ts";

export type MessagesPort = {
  messages: {
    create: (body: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: "user"; content: string }>;
    }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
};

export function createAnthropicProvider(opts: {
  apiKey: string;
  model: string;
  client?: MessagesPort;
}): ModelClient {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });

  return {
    provider: "anthropic",
    model: opts.model,
    async complete(prompt: string) {
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content
        .flatMap((block) =>
          block.type === "text" && block.text ? [block.text] : [],
        )
        .join("\n")
        .trim();
      if (!text) {
        throw new Error("anthropic returned an empty completion");
      }
      return text;
    },
  };
}
