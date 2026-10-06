import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type {
  ApprovedFact,
  Model,
  Snapshot,
} from "../application/contracts.ts";
import {
  createAnthropicModel,
  type ModelOptions,
  PROMPT_VERSION,
} from "./anthropic.ts";

const snapshot: Snapshot = {
  projectId: "project-atlas",
  documentRef: "evidence:atlas:1",
  sourceId: "standup",
  sourceVersion: "1",
  checksum: "snapshot-checksum",
  markdown: "Release task owner: Ada.",
  sourceDate: "2026-10-05",
};

const extracted = {
  entity: "Release task",
  field: "owner",
  value: "Ada",
  quote: snapshot.markdown,
  effectiveDate: snapshot.sourceDate,
};

const approved: ApprovedFact = {
  id: "approved-owner",
  candidateId: "candidate-owner",
  entity: "Release task",
  field: "owner",
  value: "Ada",
  effectiveDate: snapshot.sourceDate,
  revision: 1,
  evidence: {
    kind: "document",
    projectId: snapshot.projectId,
    documentRef: snapshot.documentRef,
    checksum: snapshot.checksum,
    sourceVersion: snapshot.sourceVersion,
    start: 0,
    end: snapshot.markdown.length,
    quote: snapshot.markdown,
  },
};

function tool(name: string, input: unknown, id = name): Anthropic.ContentBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ContentBlock;
}

function response(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.Message["stop_reason"] = "tool_use",
): Anthropic.Message {
  return {
    id: "message-fixture",
    type: "message",
    role: "assistant",
    model: "fixture",
    stop_reason: stopReason,
    stop_sequence: null,
    content,
    usage: { input_tokens: 100, output_tokens: 25 },
  } as Anthropic.Message;
}

function adapter(
  responses: Anthropic.Message[],
  options?: ModelOptions["budget"],
) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = vi.fn(
    async (body: Anthropic.MessageCreateParamsNonStreaming) => {
      requests.push(structuredClone(body));
      const next = responses.shift();
      if (!next) throw new Error("No more fixture responses");
      return next;
    },
  );
  const model = createAnthropicModel({
    model: "fixture",
    client: { create } as unknown as ModelOptions["client"],
    ...(options ? { budget: options } : {}),
  });
  return { model, create, requests };
}

function answerInput(): Parameters<Model["answer"]>[0] {
  return {
    question: "Who owns Release task?",
    approved: [approved],
    history: [],
    maxTurns: 6,
    search: vi.fn(async () => ({ passages: [], missingEmbeddings: 0 })),
    read: vi.fn(async () => snapshot),
    observe: vi.fn(),
  };
}

describe("Anthropic project-manager adapter", () => {
  it("extracts structured source facts and records bounded request usage", async () => {
    const { model, requests } = adapter(
      [response([tool("submit_facts", { facts: [extracted] })])],
      { maxCostUsd: 1, inputPricePerMillion: 1, outputPricePerMillion: 2 },
    );
    const observe = vi.fn();

    await expect(model.extract(snapshot, observe)).resolves.toEqual([
      extracted,
    ]);
    expect(requests[0]).toMatchObject({
      model: "fixture",
      max_tokens: 4096,
      messages: [{ role: "user", content: JSON.stringify(snapshot) }],
      tools: [{ name: "submit_facts" }],
    });
    expect(observe).toHaveBeenCalledWith(
      "model",
      { model: "fixture", turn: 1, promptVersion: PROMPT_VERSION },
      expect.objectContaining({ stopReason: "tool_use" }),
    );
    expect(model.usage).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      estimatedCostUsd: 0.00015,
      requests: 1,
    });
    const usage = model.usage;
    usage.requests = 999;
    expect(model.usage.requests).toBe(1);
  });

  it("returns invalid extraction schemas to the model for repair", async () => {
    const { model, create, requests } = adapter([
      response([tool("submit_facts", { facts: "invalid" }, "bad-facts")]),
      response([tool("submit_facts", { facts: [extracted] }, "good-facts")]),
    ]);

    await expect(model.extract(snapshot, vi.fn())).resolves.toEqual([
      extracted,
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(requests[1]?.messages[2]).toMatchObject({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "bad-facts", is_error: true },
      ],
    });
  });

  it("stops after three unsuccessful extraction repairs", async () => {
    const { model, create } = adapter(
      Array.from({ length: 3 }, () =>
        response([tool("submit_facts", { facts: "invalid" })]),
      ),
    );

    await expect(model.extract(snapshot, vi.fn())).rejects.toThrow(
      "Extraction exhausted its schema-repair budget",
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("passes search and immutable-read results through the answer tool loop", async () => {
    const { model, create, requests } = adapter([
      response([
        tool("search_evidence", { query: "Release task owner" }, "search"),
        tool("read_evidence", { documentRef: snapshot.documentRef }, "read"),
      ]),
      response([
        tool("finish_answer", { factIds: [approved.id], questions: [] }),
      ]),
    ]);
    const input = answerInput();

    await expect(model.answer(input)).resolves.toEqual({
      factIds: [approved.id],
      questions: [],
    });
    expect(input.search).toHaveBeenCalledWith("Release task owner");
    expect(input.read).toHaveBeenCalledWith(snapshot.documentRef);
    expect(create).toHaveBeenCalledTimes(2);
    expect(requests[1]?.messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "search",
          content: JSON.stringify({ passages: [], missingEmbeddings: 0 }),
        },
        {
          type: "tool_result",
          tool_use_id: "read",
          content: JSON.stringify(snapshot),
        },
      ],
    });
    expect(input.observe).toHaveBeenCalledWith(
      "read_evidence",
      { documentRef: snapshot.documentRef },
      snapshot,
    );
  });

  it("rejects an unapproved answer ID and accepts a corrected selection", async () => {
    const { model, requests } = adapter([
      response([
        tool(
          "finish_answer",
          { factIds: ["unapproved"], questions: [] },
          "bad",
        ),
      ]),
      response([
        tool(
          "finish_answer",
          { factIds: [approved.id], questions: [] },
          "good",
        ),
      ]),
    ]);
    const input = answerInput();

    await expect(model.answer(input)).resolves.toEqual({
      factIds: [approved.id],
      questions: [],
    });
    expect(requests[1]?.messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "bad",
          content: "Answer cites an unapproved fact ID",
          is_error: true,
        },
      ],
    });
    expect(input.observe).toHaveBeenCalledWith(
      "finish_answer",
      { factIds: ["unapproved"], questions: [] },
      null,
      "Answer cites an unapproved fact ID",
    );
  });

  it("returns tool validation and worker failures for a later clarification", async () => {
    const { model, requests } = adapter([
      response([
        tool("search_evidence", { query: " " }, "empty-search"),
        tool("read_evidence", { documentRef: "unavailable" }, "failed-read"),
        tool("unknown", {}, "unknown-tool"),
      ]),
      response([
        tool("finish_answer", {
          factIds: [],
          questions: ["Can you approve an owner?"],
        }),
      ]),
    ]);
    const input = answerInput();
    input.read = vi.fn(async () => {
      throw new Error("Only approved evidence is available to chat");
    });

    await expect(model.answer(input)).resolves.toEqual({
      factIds: [],
      questions: ["Can you approve an owner?"],
    });
    expect(input.search).not.toHaveBeenCalled();
    expect(requests[1]?.messages[2]).toMatchObject({
      role: "user",
      content: [
        { tool_use_id: "empty-search", is_error: true },
        {
          tool_use_id: "failed-read",
          content: "Only approved evidence is available to chat",
          is_error: true,
        },
        {
          tool_use_id: "unknown-tool",
          content: "Unknown answer tool",
          is_error: true,
        },
      ],
    });
  });

  it.each([1, 6])(
    "uses %s answer turns at most when evidence never yields a final answer",
    async (maxTurns) => {
      const { model, create } = adapter(
        Array.from({ length: maxTurns }, () =>
          response([tool("search_evidence", { query: "owner" })]),
        ),
      );
      const input = { ...answerInput(), maxTurns };

      await expect(model.answer(input)).rejects.toThrow(
        "Answer exhausted the model-turn budget",
      );
      expect(create).toHaveBeenCalledTimes(maxTurns);
      expect(input.search).toHaveBeenCalledTimes(maxTurns);
    },
  );

  it("does not execute additional tools after a completed answer", async () => {
    const { model } = adapter([
      response([
        tool("finish_answer", { factIds: [approved.id], questions: [] }),
        tool("search_evidence", { query: "owner" }, "after-answer"),
      ]),
    ]);
    const input = answerInput();

    await expect(model.answer(input)).resolves.toEqual({
      factIds: [approved.id],
      questions: [],
    });
    expect(input.search).not.toHaveBeenCalled();
    expect(input.observe).toHaveBeenCalledWith(
      "search_evidence",
      { query: "owner" },
      null,
      "Answer already completed",
    );
  });

  it("stops before executing a thirteenth answer tool call", async () => {
    const { model, create } = adapter([
      response(
        Array.from({ length: 13 }, (_, index) =>
          tool("search_evidence", { query: "owner" }, `search-${index}`),
        ),
      ),
    ]);
    const input = answerInput();

    await expect(model.answer(input)).rejects.toThrow(
      "Answer tool-call budget exhausted",
    );
    expect(create).toHaveBeenCalledOnce();
    expect(input.search).toHaveBeenCalledTimes(12);
  });

  it.each(["extract", "answer"] as const)(
    "fails %s when the model returns empty content",
    async (operation) => {
      const { model } = adapter([response([], "end_turn")]);
      const pending =
        operation === "extract"
          ? model.extract(snapshot, vi.fn())
          : model.answer(answerInput());
      await expect(pending).rejects.toThrow(
        operation === "extract"
          ? "Model stopped without extracted facts"
          : "Model stopped without a structured answer",
      );
    },
  );

  it.each(["extract", "answer"] as const)(
    "fails %s on a truncated max_tokens response",
    async (operation) => {
      const { model } = adapter([
        response([tool("submit_facts", { facts: [extracted] })], "max_tokens"),
      ]);
      const pending =
        operation === "extract"
          ? model.extract(snapshot, vi.fn())
          : model.answer(answerInput());
      await expect(pending).rejects.toThrow(
        "Model response exceeded output token limit",
      );
      expect(model.usage.requests).toBe(1);
    },
  );

  it("rejects a request before touching the client when its cost bound exceeds budget", async () => {
    const { model, create } = adapter([], {
      maxCostUsd: 0.000001,
      inputPricePerMillion: 1,
      outputPricePerMillion: 2,
    });

    await expect(model.extract(snapshot, vi.fn())).rejects.toThrow(
      "Supervisor evaluation budget exhausted before next request",
    );
    expect(create).not.toHaveBeenCalled();
    expect(model.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      requests: 0,
    });
  });

  it("reserves the cost bound of an in-flight request against concurrent calls", async () => {
    let complete!: (message: Anthropic.Message) => void;
    const pendingResponse = new Promise<Anthropic.Message>((resolve) => {
      complete = resolve;
    });
    let requestCount = 0;
    const create = vi.fn(async () => {
      requestCount++;
      return requestCount === 1
        ? pendingResponse
        : response([
            tool("finish_answer", { factIds: [approved.id], questions: [] }),
          ]);
    });
    const model = createAnthropicModel({
      model: "fixture",
      client: { create } as unknown as ModelOptions["client"],
      // Output-token reservation alone is $0.4096: one request fits; two do not.
      budget: {
        maxCostUsd: 0.5,
        inputPricePerMillion: 0.000001,
        outputPricePerMillion: 100,
      },
    });
    const extraction = model.extract(snapshot, vi.fn());
    expect(create).toHaveBeenCalledOnce();

    await expect(model.answer(answerInput())).rejects.toThrow(
      "Supervisor evaluation budget exhausted before next request",
    );
    expect(create).toHaveBeenCalledOnce();
    complete(response([tool("submit_facts", { facts: [extracted] })]));
    await expect(extraction).resolves.toEqual([extracted]);

    await expect(model.answer(answerInput())).resolves.toEqual({
      factIds: [approved.id],
      questions: [],
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(model.usage.requests).toBe(2);
  });

  it("releases the reservation and records a failed client request before retry", async () => {
    const { model, create } = adapter(
      [response([tool("submit_facts", { facts: [extracted] })])],
      {
        maxCostUsd: 0.5,
        inputPricePerMillion: 0.000001,
        outputPricePerMillion: 100,
      },
    );
    create.mockRejectedValueOnce(new Error("Model temporarily unavailable"));
    const observe = vi.fn();

    await expect(model.extract(snapshot, observe)).rejects.toThrow(
      "Model temporarily unavailable",
    );
    expect(observe).toHaveBeenCalledWith(
      "model_error",
      { model: "fixture", turn: 1, promptVersion: PROMPT_VERSION },
      { durationMs: expect.any(Number) },
      "Model temporarily unavailable",
    );
    expect(model.usage.requests).toBe(0);
    await expect(model.extract(snapshot, observe)).resolves.toEqual([
      extracted,
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(model.usage.requests).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid evaluation budget %s before any request",
    (maxCostUsd) => {
      expect(() =>
        createAnthropicModel({
          model: "fixture",
          budget: {
            maxCostUsd,
            inputPricePerMillion: 1,
            outputPricePerMillion: 2,
          },
        }),
      ).toThrow(
        "Live evaluation requires positive finite budget and token prices",
      );
    },
  );

  it.each([
    [0, 2],
    [-1, 2],
    [Number.NaN, 2],
    [Number.POSITIVE_INFINITY, 2],
    [1, 0],
    [1, -1],
    [1, Number.NaN],
    [1, Number.POSITIVE_INFINITY],
  ])(
    "rejects invalid input/output token prices %s/%s",
    (inputPricePerMillion, outputPricePerMillion) => {
      expect(() =>
        createAnthropicModel({
          model: "fixture",
          budget: {
            maxCostUsd: 1,
            inputPricePerMillion,
            outputPricePerMillion,
          },
        }),
      ).toThrow(
        "Live evaluation requires positive finite budget and token prices",
      );
    },
  );
});
