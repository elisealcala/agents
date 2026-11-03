import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchManagerRequest } from "./manager-transport.ts";

describe("private manager transport", () => {
  it("uses the primary private object and ignores the configured network host", async () => {
    const calls: string[] = [];
    let received: Request | undefined;
    let networkCalls = 0;
    const binding = {
      idFromName(name: string): string {
        calls.push(`id:${name}`);
        return "fixture-object-id";
      },
      get(id: unknown) {
        calls.push(`get:${String(id)}`);
        return {
          async fetch(request: Request): Promise<Response> {
            received = request;
            return new Response("private", { status: 202 });
          },
        };
      },
    };
    const fetchImpl: typeof fetch = async () => {
      networkCalls += 1;
      return new Response("network");
    };
    const response = await dispatchManagerRequest({
      binding,
      target: new URL("https://configured.example/projects.list?batch=1"),
      method: "GET",
      headers: {
        authorization: "Bearer fixture-secret",
        "x-manager-actor": "123",
      },
      allowNetworkFallback: true,
      fetchImpl,
    });

    assert.equal(response.status, 202);
    assert.equal(await response.text(), "private");
    assert.deepEqual(calls, ["id:primary", "get:fixture-object-id"]);
    assert.equal(networkCalls, 0);
    assert.ok(received);
    assert.equal(
      received.url,
      "https://manager.internal/trpc/projects.list?batch=1",
    );
    assert.equal(
      received.headers.get("authorization"),
      "Bearer fixture-secret",
    );
    assert.equal(received.headers.get("x-manager-actor"), "123");
    assert.equal(received.redirect, "manual");
    assert.equal(received.signal.aborted, false);
  });

  it("preserves an existing tRPC prefix, POST body, and service headers", async () => {
    let received: Request | undefined;
    const binding = {
      idFromName: () => "id",
      get: () => ({
        async fetch(request: Request): Promise<Response> {
          received = request;
          return Response.json({ ok: true });
        },
      }),
    };
    const encoded = new TextEncoder().encode('{"name":"fixture"}');
    await dispatchManagerRequest({
      binding,
      target: new URL("https://unused.example/trpc/projects.create?batch=1"),
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer fixture-secret",
      },
      body: encoded.buffer,
      allowNetworkFallback: false,
    });

    assert.ok(received);
    assert.equal(
      received.url,
      "https://manager.internal/trpc/projects.create?batch=1",
    );
    assert.equal(received.method, "POST");
    assert.equal(received.headers.get("content-type"), "application/json");
    assert.equal(
      received.headers.get("authorization"),
      "Bearer fixture-secret",
    );
    assert.equal(await received.text(), '{"name":"fixture"}');
  });

  it("rejects a missing binding without sending a network request", async () => {
    let networkCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      networkCalls += 1;
      return new Response();
    };
    await assert.rejects(
      dispatchManagerRequest({
        target: new URL("https://configured.example/trpc/projects.list"),
        method: "GET",
        headers: { authorization: "Bearer fixture-secret" },
        allowNetworkFallback: false,
        fetchImpl,
      }),
      /Private manager binding is unavailable/,
    );
    assert.equal(networkCalls, 0);
  });

  it("uses the configured target only when the local fallback is explicitly enabled", async () => {
    let captured: { input: string; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      captured = { input: String(input), init };
      return new Response("local");
    };
    const encoded = new TextEncoder().encode("fixture body");
    const response = await dispatchManagerRequest({
      target: new URL("http://127.0.0.1:8788/projects.create?batch=1"),
      method: "POST",
      headers: { authorization: "Bearer fixture-secret" },
      body: encoded.buffer,
      allowNetworkFallback: true,
      fetchImpl,
    });

    assert.equal(await response.text(), "local");
    assert.ok(captured);
    assert.equal(
      captured.input,
      "http://127.0.0.1:8788/projects.create?batch=1",
    );
    assert.equal(captured.init?.method, "POST");
    assert.equal(captured.init?.cache, "no-store");
    assert.equal(captured.init?.redirect, "manual");
    assert.equal(
      new Headers(captured.init?.headers).get("authorization"),
      "Bearer fixture-secret",
    );
    assert.equal(
      new TextDecoder().decode(captured.init?.body as ArrayBuffer),
      "fixture body",
    );
    assert.ok(captured.init?.signal);
  });

  it("does not fall back to the network when a private binding fails", async () => {
    let networkCalls = 0;
    const binding = {
      idFromName: () => "id",
      get: () => ({
        async fetch(): Promise<Response> {
          throw new Error("fixture binding failure");
        },
      }),
    };
    const fetchImpl: typeof fetch = async () => {
      networkCalls += 1;
      return new Response();
    };
    await assert.rejects(
      dispatchManagerRequest({
        binding,
        target: new URL("https://configured.example/trpc/projects.list"),
        method: "GET",
        headers: { authorization: "Bearer fixture-secret" },
        allowNetworkFallback: true,
        fetchImpl,
      }),
      /fixture binding failure/,
    );
    assert.equal(networkCalls, 0);
  });

  it("propagates a failure from the explicitly enabled local fallback", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("fixture network failure");
    };
    await assert.rejects(
      dispatchManagerRequest({
        target: new URL("http://localhost:8788/projects.list"),
        method: "GET",
        headers: {},
        allowNetworkFallback: true,
        fetchImpl,
      }),
      /fixture network failure/,
    );
  });

  it("rejects every redirect from a private binding without contacting the network", async () => {
    for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
      let privateCalls = 0;
      let networkCalls = 0;
      const binding = {
        idFromName: () => "fixture",
        get: () => ({
          async fetch(request: Request): Promise<Response> {
            privateCalls += 1;
            assert.equal(request.redirect, "manual");
            return new Response(null, {
              status,
              headers: { location: "https://other.example/" },
            });
          },
        }),
      };
      const fetchImpl: typeof fetch = async () => {
        networkCalls += 1;
        return new Response();
      };
      await assert.rejects(
        dispatchManagerRequest({
          binding,
          target: new URL("https://configured.example/trpc/projects.list"),
          method: "GET",
          headers: { authorization: "Bearer fixture-secret" },
          allowNetworkFallback: true,
          fetchImpl,
        }),
        /Manager redirect refused/,
        `redirect status ${status}`,
      );
      assert.equal(privateCalls, 1, `redirect status ${status}`);
      assert.equal(networkCalls, 0, `redirect status ${status}`);
    }
  });

  it("rejects redirects from the local fallback without a second request", async () => {
    for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
      let networkCalls = 0;
      const fetchImpl: typeof fetch = async (_input, init) => {
        networkCalls += 1;
        assert.equal(init?.redirect, "manual");
        return new Response(null, {
          status,
          headers: { location: "https://other.example/" },
        });
      };
      await assert.rejects(
        dispatchManagerRequest({
          target: new URL("http://localhost:8788/projects.list"),
          method: "GET",
          headers: { authorization: "Bearer fixture-secret" },
          allowNetworkFallback: true,
          fetchImpl,
        }),
        /Manager redirect refused/,
        `redirect status ${status}`,
      );
      assert.equal(networkCalls, 1, `redirect status ${status}`);
    }
  });
});
