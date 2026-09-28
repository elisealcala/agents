/**
 * The Anthropic adapter.
 *
 * Like the other providers it sends one user message containing instructions
 * and input together; there is no system message and no conversation history.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "./types.ts";

/**
 * Response cap for a classification completion.
 *
 * Anthropic requires an explicit cap where OpenAI and xAI do not, so this
 * limit applies to this provider alone. It bounds a classification response,
 * not a document: the reply is a small JSON object. Note that the adaptive
 * prompt embeds the whole live taxonomy, so a large library makes the reply
 * longer; if truncation starts causing parse failures, raise this first.
 */
const ANTHROPIC_MAX_TOKENS = 256;

/** The slice of the Anthropic SDK this adapter uses, so tests can substitute it. */
export type MessagesPort = {
  messages: {
    create: (body: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: "user"; content: string }>;
    }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
};

/** How an Anthropic client is constructed. */
export type AnthropicProviderOptions = {
  apiKey: string;
  model: string;
  client?: MessagesPort;
};

/** Build an Anthropic-backed {@link ModelClient}. */
export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): ModelClient {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  return {
    provider: "anthropic",
    model: options.model,
    async complete(prompt: string) {
      const response = await client.messages.create({
        model: options.model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
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
