import { describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "./openai.ts";
import { createXaiProvider } from "./xai.ts";
import { createAnthropicProvider } from "./anthropic.ts";

describe("providers with injected clients", () => {
  it("openai complete reads chat.completions message text", async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: "  gpt-ok  " } }],
    }));
    const client = createOpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-4.1",
      client: { chat: { completions: { create } } },
    });

    await expect(client.complete("hi")).resolves.toBe("gpt-ok");
    expect(create).toHaveBeenCalledWith({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("xai complete uses the same chat completions shape", async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: "grok-ok" } }],
    }));
    const client = createXaiProvider({
      apiKey: "xai-test",
      model: "grok-4",
      client: { chat: { completions: { create } } },
    });

    await expect(client.complete("hi")).resolves.toBe("grok-ok");
    expect(client.provider).toBe("xai");
  });

  it("anthropic complete joins text blocks", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "text", text: "claude" },
        { type: "text", text: "ok" },
      ],
    }));
    const client = createAnthropicProvider({
      apiKey: "ant-test",
      model: "claude-sonnet-4-20250514",
      client: { messages: { create } },
    });

    await expect(client.complete("hi")).resolves.toBe("claude\nok");
    expect(create).toHaveBeenCalledWith({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      messages: [{ role: "user", content: "hi" }],
    });
  });
});
