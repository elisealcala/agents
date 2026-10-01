import { describe, expect, it, vi } from "vitest";
import { createModelClient } from "./create-client.ts";
import type { ModelClient } from "./types.ts";

describe("createModelClient", () => {
  it("builds an Anthropic client from the model and key", () => {
    const created = vi.fn(
      (): ModelClient => ({
        provider: "anthropic",
        model: "claude-test",
        complete: vi.fn(async () => "ok"),
        runTools: vi.fn(async () => undefined),
      }),
    );

    const client = createModelClient(
      {
        provider: "anthropic",
        model: "claude-test",
        apiKey: "ant-test",
      },
      created,
    );

    expect(client.provider).toBe("anthropic");
    expect(client.model).toBe("claude-test");
    expect(created).toHaveBeenCalledWith({
      apiKey: "ant-test",
      model: "claude-test",
    });
  });
});
