/**
 * The Anthropic client both entry points share (DEC-025).
 *
 * Organizing a note uses {@link ModelClient.runTools}: a system prompt, the
 * note as the user message, and tools. A retry starts a fresh loop and does
 * not keep the rejected attempt. Grounded answers use {@link ModelClient.complete},
 * which is a system prompt plus a user message and never calls tools.
 */
import type { AgentHooks } from "../agent/hooks.ts";
import type { Provider } from "../config.ts";

/** A system prompt and the user message for one completion. */
export type CompletionInput = {
  system: string;
  user: string;
};

/** JSON Schema for one organizer tool. Anthropic requires an object schema. */
export type ToolInputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** One tool the organizer may call. */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
};

/**
 * What a tool handler returns to the model.
 *
 * `terminal` means the placement was valid. The loop stops after the rest of
 * that turn's tool results are recorded, and does not ask the model again.
 */
export type ToolOutcome = {
  content: string;
  isError?: boolean;
  terminal?: boolean;
};

/**
 * One step of a tool loop, for a caller that wants to watch it.
 *
 * Absent on the CLI and MCP paths. A studio run records every event, including
 * a rejected tool call and a retry the organizer itself discards.
 */
export type ToolLoopEvent =
  | {
      type: "model";
      turn: number;
      system: string;
      status: "start" | "ok" | "failed";
      error?: string;
    }
  | {
      type: "tool";
      name: string;
      input: unknown;
      outcome: ToolOutcome;
    };

/** Receives {@link ToolLoopEvent}s. Optional, so existing loops stay quiet. */
export type ToolLoopObserver = (event: ToolLoopEvent) => void;

/** One organizing attempt: instructions, the note, tools, and their handler. */
export type ToolRunInput = {
  system: string;
  user: string;
  tools: ToolDefinition[];
  execute: (name: string, input: unknown) => Promise<ToolOutcome>;
  observe?: ToolLoopObserver;
  /** PreToolUse hooks. A deny blocks {@link ToolRunInput.execute}. */
  hooks?: AgentHooks;
};

/** A configured Anthropic model. */
export type ModelClient = {
  provider: Provider;
  model: string;
  complete(input: CompletionInput): Promise<string>;
  runTools(input: ToolRunInput): Promise<void>;
};
