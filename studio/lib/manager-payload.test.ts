import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeManagerPayload } from "./manager-payload.ts";

const generic = "The manager could not complete this request.";

describe("hosted manager payload sanitization", () => {
  it("preserves ordinary notes and null errors without mutating the input", () => {
    const value = {
      result: {
        data: {
          json: {
            markdown: "The error budget is 10%.",
            quote: "A stack of notes belongs here.",
            error: null,
            notes: [{ sourceId: "meeting", markdown: "Use error as a label." }],
          },
        },
      },
    };
    const original = structuredClone(value);
    assert.deepEqual(sanitizeManagerPayload(value), original);
    assert.deepEqual(value, original);
  });

  it("redacts errors and removes stacks recursively through batched and nested result data", () => {
    const value = [
      {
        result: {
          data: {
            json: {
              status: "error",
              error: "provider private-token-fixture",
              stack: "private-stack",
            },
          },
        },
      },
      {
        result: {
          data: {
            json: {
              spans: [
                { error: "private-path", stack: "nested-stack", name: "step" },
              ],
              error: null,
            },
          },
        },
      },
      { result: { data: { json: { error: ["private-message"] } } } },
    ];
    const sanitized = sanitizeManagerPayload(value);
    assert.deepEqual(sanitized, [
      { result: { data: { json: { status: "error", error: generic } } } },
      {
        result: {
          data: {
            json: { spans: [{ error: generic, name: "step" }], error: null },
          },
        },
      },
      { result: { data: { json: { error: generic } } } },
    ]);
    assert.doesNotMatch(
      JSON.stringify(sanitized),
      /private-token-fixture|private-stack|private-path|nested-stack|private-message/,
    );
  });

  it("sanitizes a tRPC error envelope while retaining client-readable status and path", () => {
    const value = {
      error: {
        message: "database password was leaked",
        code: -32603,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          path: "notes.submit",
          stack: "secret stack",
          cause: "private cause",
        },
      },
    };
    assert.deepEqual(sanitizeManagerPayload(value), {
      error: {
        message: generic,
        code: -32603,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          path: "notes.submit",
        },
      },
    });
  });

  it("preserves status and path for transformed tRPC error envelopes", () => {
    const value = [
      {
        error: {
          json: {
            message: "private failure",
            code: -32603,
            data: {
              code: "INTERNAL_SERVER_ERROR",
              httpStatus: 500,
              path: "projects.get",
              stack: "secret stack",
            },
          },
        },
      },
    ];
    const sanitized = sanitizeManagerPayload(value);
    assert.deepEqual(sanitized, [
      {
        error: {
          json: {
            message: generic,
            code: -32603,
            data: {
              code: "INTERNAL_SERVER_ERROR",
              httpStatus: 500,
              path: "projects.get",
            },
          },
        },
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(sanitized),
      /private failure|secret stack/,
    );
  });

  it("handles primitive and null values without modification", () => {
    for (const value of [null, undefined, false, 0, "plain text"]) {
      assert.equal(sanitizeManagerPayload(value), value);
    }
  });
});
