import { describe, expect, it } from "vitest";
import { hookMatches, runPreToolUse } from "./hooks.ts";

describe("PreToolUse hooks", () => {
  it("matches a tool name the way the Claude Agent SDK matcher does", () => {
    expect(hookMatches("file_existing|propose_child", "file_existing")).toBe(
      true,
    );
    expect(hookMatches("file_existing|propose_child", "propose_child")).toBe(
      true,
    );
    expect(hookMatches("file_existing|propose_child", "list_categories")).toBe(
      false,
    );
    expect(hookMatches(undefined, "list_categories")).toBe(true);
  });

  it("stops at the first deny and skips later hooks", async () => {
    const calls: string[] = [];
    const decision = await runPreToolUse(
      {
        PreToolUse: [
          {
            matcher: "file_existing|propose_child",
            hooks: [
              async () => {
                calls.push("first");
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason:
                      "existing category fit_score must be greater than 0.80",
                  },
                };
              },
              async () => {
                calls.push("second");
                return {};
              },
            ],
          },
        ],
      },
      {
        hook_event_name: "PreToolUse",
        tool_name: "file_existing",
        tool_input: {},
        tool_use_id: "tool-1",
      },
    );

    expect(decision).toEqual({
      denied: true,
      reason: "existing category fit_score must be greater than 0.80",
    });
    expect(calls).toEqual(["first"]);
  });

  it("leaves an unmatched tool alone", async () => {
    const decision = await runPreToolUse(
      {
        PreToolUse: [
          {
            matcher: "file_existing|propose_child",
            hooks: [
              async () => {
                throw new Error("must not run");
              },
            ],
          },
        ],
      },
      {
        hook_event_name: "PreToolUse",
        tool_name: "list_recent_filings",
        tool_input: {},
        tool_use_id: "tool-2",
      },
    );

    expect(decision).toEqual({ denied: false });
  });
});
