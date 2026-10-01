import { describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "./anthropic.ts";
import type { ToolRunInput } from "./types.ts";

const MAX_TURNS = 8;

describe("anthropic provider", () => {
  it("sends the system prompt and user message separately", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
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

    await expect(
      client.complete({ system: "Be brief.", user: "hi" }),
    ).resolves.toBe("claude\nok");
    expect(create).toHaveBeenCalledWith({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("stops the tool loop when a terminal tool succeeds", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "list-1",
            name: "list_categories",
            input: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "file-1",
            name: "file_existing",
            input: { category: "project_specs" },
          },
        ],
      });
    const client = createAnthropicProvider({
      apiKey: "ant-test",
      model: "claude-sonnet-4-20250514",
      client: { messages: { create } },
    });
    const execute = vi.fn<ToolRunInput["execute"]>(async (name) =>
      name === "file_existing"
        ? { content: "Placement recorded.", terminal: true }
        : { content: "- project_specs (Project Specs): Plans." },
    );

    await client.runTools({
      system: "Organize one note.",
      user: "The note.",
      tools: [
        {
          name: "list_categories",
          description: "List categories.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    const secondCall = create.mock.calls[1]?.[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const toolResult = secondCall.messages[2];
    expect(toolResult?.role).toBe("user");
    expect(toolResult?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "list-1",
        content: "- project_specs (Project Specs): Plans.",
      },
    ]);
  });

  it("returns a rejected tool call to the model and continues", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "bad", name: "file_existing", input: {} },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "good", name: "file_existing", input: {} },
        ],
      });
    const client = createAnthropicProvider({
      apiKey: "ant-test",
      model: "claude-sonnet-4-20250514",
      client: { messages: { create } },
    });
    let calls = 0;
    await client.runTools({
      system: "Organize.",
      user: "Note.",
      tools: [],
      execute: async () => {
        calls += 1;
        return calls === 1
          ? { content: "category must be a seed category id", isError: true }
          : { content: "Placement recorded.", terminal: true };
      },
    });

    const secondCall = create.mock.calls[1]?.[0] as {
      messages: Array<{ content: unknown }>;
    };
    expect(secondCall.messages[2]?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "bad",
        content: "category must be a seed category id",
        is_error: true,
      },
    ]);
  });

  it("a PreToolUse deny blocks the tool handler and returns the reason", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "bad", name: "file_existing", input: {} },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "good",
            name: "file_existing",
            input: { category: "project_specs" },
          },
        ],
      });
    const client = createAnthropicProvider({
      apiKey: "ant-test",
      model: "claude-sonnet-4-20250514",
      client: { messages: { create } },
    });
    const execute = vi.fn(async () => ({
      content: "Placement recorded.",
      terminal: true,
    }));

    await client.runTools({
      system: "Organize.",
      user: "Note.",
      tools: [],
      execute,
      hooks: {
        PreToolUse: [
          {
            matcher: "file_existing",
            hooks: [
              async (input) =>
                input.tool_use_id === "bad"
                  ? {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "deny",
                        permissionDecisionReason:
                          "existing category fit_score must be greater than 0.80",
                      },
                    }
                  : {},
            ],
          },
        ],
      },
    });

    expect(execute).toHaveBeenCalledOnce();
    const secondCall = create.mock.calls[1]?.[0] as {
      messages: Array<{ content: unknown }>;
    };
    expect(secondCall.messages[2]?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "bad",
        content: "existing category fit_score must be greater than 0.80",
        is_error: true,
      },
    ]);
  });

  it("fails when the model stops without calling a tool", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I am done." }],
    }));
    const client = createAnthropicProvider({
      apiKey: "ant-test",
      model: "claude-sonnet-4-20250514",
      client: { messages: { create } },
    });

    await expect(
      client.runTools({
        system: "Organize.",
        user: "Note.",
        tools: [],
        execute: async () => ({ content: "unused" }),
      }),
    ).rejects.toThrow(/stopped without a placement/);
  });

  it("fails when the placement never arrives within the turn cap", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "again", name: "list_categories", input: {} },
      ],
    }));
    const client = createAnthropicProvider({
      apiKey: "ant-test",
      model: "claude-sonnet-4-20250514",
      client: { messages: { create } },
    });

    await expect(
      client.runTools({
        system: "Organize.",
        user: "Note.",
        tools: [],
        execute: async () => ({ content: "categories" }),
      }),
    ).rejects.toThrow(
      new RegExp(`${MAX_TURNS} tool turns without a placement`),
    );
    expect(create).toHaveBeenCalledTimes(MAX_TURNS);
  });
});
