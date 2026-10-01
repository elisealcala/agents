/**
 * The Anthropic adapter (DEC-025).
 *
 * Organizing sends a system prompt and loops on tool calls. Grounded answers
 * send a system prompt and a user message, with no tools and no history.
 */
import Anthropic from "@anthropic-ai/sdk";
import { runPreToolUse } from "../agent/hooks.ts";
import type {
  ModelClient,
  ToolDefinition,
  ToolOutcome,
  ToolRunInput,
} from "./types.ts";

/**
 * Response cap for one Anthropic turn.
 *
 * The SDK requires an explicit cap. It bounds the model reply, not the note:
 * an organizer turn is a tool call, and a grounded answer is a short paragraph.
 */
const ANTHROPIC_MAX_TOKENS = 1024;

/**
 * How many model turns one organizing attempt may take.
 *
 * A placement is recent filings, a similarity search, a taxonomy lookup, and
 * one terminal tool. The spare turns are for a hook that denied the placement.
 */
const MAX_ORGANIZER_TOOL_TURNS = 8;

/**
 * A content block the adapter reads or sends back.
 *
 * Assistant blocks keep the vendor fields the next request must echo.
 * Tool results use `tool_use_id` and `content`.
 */
type ModelContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

/** The slice of the Anthropic SDK this adapter uses, so tests can substitute it. */
export type MessagesPort = {
  messages: {
    create: (body: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: Array<{
        role: "user" | "assistant";
        content: string | ModelContentBlock[];
      }>;
      tools?: Array<{
        name: string;
        description: string;
        input_schema: ToolDefinition["inputSchema"];
      }>;
    }) => Promise<{
      stop_reason: string | null;
      content: ModelContentBlock[];
    }>;
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
  const client =
    options.client ?? wrapAnthropic(new Anthropic({ apiKey: options.apiKey }));

  return {
    provider: "anthropic",
    model: options.model,
    async complete(input) {
      const response = await client.messages.create({
        model: options.model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
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
    async runTools(input) {
      await runToolLoop(client, options.model, input);
    },
  };
}

async function runToolLoop(
  client: MessagesPort,
  model: string,
  input: ToolRunInput,
): Promise<void> {
  const messages: Array<{
    role: "user" | "assistant";
    content: string | ModelContentBlock[];
  }> = [{ role: "user", content: input.user }];
  const tools = input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  for (let turn = 1; turn <= MAX_ORGANIZER_TOOL_TURNS; turn += 1) {
    input.observe?.({
      type: "model",
      turn,
      system: input.system,
      status: "start",
    });
    let response: { stop_reason: string | null; content: ModelContentBlock[] };
    try {
      response = await client.messages.create({
        model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: input.system,
        messages,
        tools,
      });
    } catch (error) {
      input.observe?.({
        type: "model",
        turn,
        system: input.system,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (response.stop_reason === "max_tokens") {
      const error = "anthropic response hit the token cap";
      input.observe?.({
        type: "model",
        turn,
        system: input.system,
        status: "failed",
        error,
      });
      throw new Error(error);
    }
    const calls = toolCalls(response.content);
    if (calls.length === 0) {
      const error = "organizer stopped without a placement";
      input.observe?.({
        type: "model",
        turn,
        system: input.system,
        status: "failed",
        error,
      });
      throw new Error(error);
    }
    input.observe?.({
      type: "model",
      turn,
      system: input.system,
      status: "ok",
    });
    messages.push({ role: "assistant", content: response.content });
    const results: ModelContentBlock[] = [];
    let terminal = false;
    for (const call of calls) {
      const outcome = await runTool(input, call);
      input.observe?.({
        type: "tool",
        name: call.name,
        input: call.input,
        outcome,
      });
      if (outcome.terminal) terminal = true;
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
    if (terminal) return;
  }

  throw new Error(
    `organizer exceeded ${MAX_ORGANIZER_TOOL_TURNS} tool turns without a placement`,
  );
}

async function runTool(
  input: ToolRunInput,
  call: { id: string; name: string; input: unknown },
): Promise<ToolOutcome> {
  const decision = await runPreToolUse(input.hooks, {
    hook_event_name: "PreToolUse",
    tool_name: call.name,
    tool_input: call.input,
    tool_use_id: call.id,
  });
  if (decision.denied) {
    return { content: decision.reason, isError: true };
  }
  try {
    return await input.execute(call.name, call.input);
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

function toolCalls(
  content: ModelContentBlock[],
): Array<{ id: string; name: string; input: unknown }> {
  return content.flatMap((block) =>
    block.type === "tool_use" && block.id && block.name
      ? [{ id: block.id, name: block.name, input: block.input }]
      : [],
  );
}

function wrapAnthropic(client: Anthropic): MessagesPort {
  return {
    messages: {
      async create(body) {
        const response = await client.messages.create({
          model: body.model,
          max_tokens: body.max_tokens,
          system: body.system,
          messages: body.messages as Anthropic.MessageParam[],
          tools: body.tools,
        });
        return {
          stop_reason: response.stop_reason,
          content: response.content,
        };
      },
    },
  };
}
