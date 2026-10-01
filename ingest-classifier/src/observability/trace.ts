/**
 * A run's trace: nested spans for stages, model turns, and tool calls.
 *
 * The CLI and MCP server never construct one. The studio server does, and
 * persists whatever the observer records.
 */
import type { ToolLoopEvent } from "../providers/types.ts";

/** What kind of step a span is. An orchestrator reuses the same four. */
export type SpanKind = "action" | "stage" | "model" | "tool";

/** `running` is still open. `ok` and `failed` are finished. */
export type SpanStatus = "running" | "ok" | "failed";

/** Opens a span. The returned id is what children use as `parentId`. */
export type TraceObserver = {
  start(span: {
    parentId: string | null;
    name: string;
    kind: SpanKind;
    input?: unknown;
  }): string;
  end(
    id: string,
    result: { status: "ok" | "failed"; output?: unknown; error?: string },
  ): void;
};

/**
 * Turn tool-loop events into spans under one classify step.
 *
 * A failed model turn and a rejected tool stay in the tree. The next attempt
 * starts new spans rather than erasing these.
 */
export function observeToolLoop(
  observer: TraceObserver,
  parentId: string,
): (event: ToolLoopEvent) => void {
  let modelSpanId: string | undefined;
  return (event) => {
    if (event.type === "model" && event.status === "start") {
      modelSpanId = observer.start({
        parentId,
        name: "model",
        kind: "model",
        input: { system: event.system, turn: event.turn },
      });
      return;
    }
    if (event.type === "model") {
      if (!modelSpanId) return;
      observer.end(modelSpanId, {
        status: event.status === "ok" ? "ok" : "failed",
        error: event.error,
      });
      return;
    }
    const toolId = observer.start({
      parentId: modelSpanId ?? parentId,
      name: event.name,
      kind: "tool",
      input: event.input,
    });
    observer.end(toolId, {
      status: event.outcome.isError ? "failed" : "ok",
      output: {
        content: event.outcome.content,
        terminal: event.outcome.terminal === true,
      },
    });
  };
}
