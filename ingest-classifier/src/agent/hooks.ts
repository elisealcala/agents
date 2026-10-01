/**
 * PreToolUse hooks for the organizer loop (DEC-027).
 *
 * This follows the Claude Agent SDK hook contract:
 * https://code.claude.com/docs/en/agent-sdk/hooks
 *
 * 1. The tool loop is about to run a tool, so it fires `PreToolUse`.
 * 2. Each matcher is a regular expression tested against the tool name.
 *    `file_existing|propose_child` runs only for those two tools.
 * 3. The callback returns `permissionDecision: "deny"` to block the handler,
 *    or an empty object to allow it.
 * 4. A deny is the tool error the model sees. The handler does not run.
 *
 * The adaptive classifier is that callback. It accepts a placement that meets
 * the live-taxonomy rules and denies anything else, with the rule in the reason.
 */
export type PreToolUseHookInput = {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
};

/** What a hook returns. An empty object allows the tool to run. */
export type HookOutput = {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision?: "allow" | "deny";
    permissionDecisionReason?: string;
  };
};

/** A callback the loop invokes for one matching event. */
export type HookCallback = (input: PreToolUseHookInput) => Promise<HookOutput>;

/**
 * One registration. `matcher` is a regular expression over the tool name.
 * Omit it to run on every PreToolUse event.
 */
export type HookMatcher = {
  matcher?: string;
  hooks: HookCallback[];
};

/** Hooks attached to one agent run. */
export type AgentHooks = {
  PreToolUse?: HookMatcher[];
};

/** Whether a matcher selects this tool. An empty matcher selects every tool. */
export function hookMatches(
  matcher: string | undefined,
  toolName: string,
): boolean {
  if (!matcher) return true;
  return new RegExp(`^(?:${matcher})$`).test(toolName);
}

/**
 * Run every matching PreToolUse hook.
 *
 * The first deny wins. Later hooks do not run, and the tool handler must not
 * run either.
 */
export async function runPreToolUse(
  hooks: AgentHooks | undefined,
  input: PreToolUseHookInput,
): Promise<{ denied: false } | { denied: true; reason: string }> {
  for (const registration of hooks?.PreToolUse ?? []) {
    if (!hookMatches(registration.matcher, input.tool_name)) continue;
    for (const hook of registration.hooks) {
      const output = await hook(input);
      if (output.hookSpecificOutput?.permissionDecision === "deny") {
        return {
          denied: true,
          reason:
            output.hookSpecificOutput.permissionDecisionReason ??
            "tool call denied",
        };
      }
    }
  }
  return { denied: false };
}
