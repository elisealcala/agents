import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

let actor: string | undefined;
let mode:
  | "available"
  | "missing"
  | "context-error"
  | "fetch-error"
  | "redirect"
  | "http-error"
  | "invalid-json";
let payload: unknown;
let calls: Request[] = [];
let ids: string[] = [];
const token = "fixture-service-token-0123456789-abc";
mock.module(pathToFileURL(`${process.cwd()}/auth.ts`), {
  namedExports: { auth: async () => (actor ? { user: { id: actor } } : null) },
});
mock.module("@opennextjs/cloudflare", {
  namedExports: {
    getCloudflareContext: () => {
      if (mode === "context-error")
        throw new Error("sensitive context details");
      return {
        env: {
          MANAGER:
            mode === "missing"
              ? undefined
              : {
                  idFromName(name: string) {
                    ids.push(name);
                    return "object-id";
                  },
                  get(id: unknown) {
                    assert.equal(id, "object-id");
                    return {
                      fetch: async (request: Request) => {
                        calls.push(request);
                        if (mode === "fetch-error")
                          throw new Error("sensitive backend details");
                        if (mode === "redirect")
                          return new Response(null, {
                            status: 302,
                            headers: { location: "https://private.example" },
                          });
                        if (mode === "http-error")
                          return new Response("sensitive backend details", {
                            status: 500,
                          });
                        if (mode === "invalid-json")
                          return new Response("broken json");
                        return Response.json(payload);
                      },
                    };
                  },
                },
        },
      };
    },
  },
});
let GET: typeof import("../app/api/manager-backup/route.ts").GET;
const originalEnv = { ...process.env };

describe("manager backup status route", () => {
  before(async () => {
    ({ GET } = await import("../app/api/manager-backup/route.ts"));
  });
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      MANAGER_HOSTED: "true",
      MANAGER_OWNER_ID: "123456",
      AUTH_SECRET: "fixture-secret-with-at-least-32-characters",
      AUTH_GITHUB_ID: "fixture-client",
      AUTH_GITHUB_SECRET: "fixture-secret",
      AUTH_URL: "http://localhost:3000",
      MANAGER_SERVICE_TOKEN: token,
    });
    actor = "123456";
    mode = "available";
    payload = {
      configured: true,
      hasBackup: true,
      latest: {
        state: "ok",
        at: "2026-11-02T12:00:00.000Z",
        key: "secret/private-backup.json",
        nested: "secret",
      },
      next: 1793620800000,
      token: "secret",
    };
    calls = [];
    ids = [];
  });
  after(() => {
    process.env = originalEnv;
  });

  it("requires hosted mode, a configured login and the owner", async () => {
    process.env.MANAGER_HOSTED = "false";
    assert.equal((await GET()).status, 404);
    process.env.MANAGER_HOSTED = "true";
    delete process.env.AUTH_SECRET;
    assert.equal((await GET()).status, 503);
    process.env.AUTH_SECRET = "fixture-secret-with-at-least-32-characters";
    for (const id of [undefined, "wrong-owner"]) {
      actor = id;
      const response = await GET();
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.equal(calls.length, 0);
  });

  it("only forwards to the primary private binding and returns a minimal status", async () => {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      configured: true,
      hasBackup: true,
      latest: { state: "ok", at: "2026-11-02T12:00:00.000Z" },
      next: 1793620800000,
    });
    assert.deepEqual(ids, ["primary"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://manager.internal/backup/status");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].redirect, "manual");
    assert.equal(calls[0].headers.get("authorization"), `Bearer ${token}`);
    assert.equal(calls[0].headers.get("x-manager-actor"), "123456");
  });

  it("accepts empty status and error status while stripping private metadata", async () => {
    for (const status of [
      { configured: false, hasBackup: false, latest: null, next: null },
      {
        configured: true,
        hasBackup: true,
        latest: {
          state: "error",
          at: "2026-11-02T12:00:00.000Z",
          key: "private-key",
        },
        next: null,
      },
    ]) {
      payload = status;
      const response = await GET();
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.doesNotMatch(text, /private-key/);
      assert.equal(JSON.parse(text).hasBackup, status.hasBackup);
    }
  });

  it("fails closed for absent credentials or private binding and sanitizes transport failures", async () => {
    for (const value of ["", "short"]) {
      process.env.MANAGER_SERVICE_TOKEN = value;
      assert.equal((await GET()).status, 503);
    }
    process.env.MANAGER_SERVICE_TOKEN = token;
    for (const value of [
      "missing",
      "context-error",
      "fetch-error",
      "redirect",
      "http-error",
      "invalid-json",
    ] as const) {
      mode = value;
      const response = await GET();
      assert.equal(response.status, 503, value);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(
        await response.text(),
        '{"error":"Backup status unavailable."}',
      );
    }
  });

  it("rejects malformed upstream status instead of returning it", async () => {
    for (const value of [
      null,
      {},
      { configured: "yes", hasBackup: false, latest: null, next: null },
      { configured: true, hasBackup: false, latest: "bad", next: null },
      {
        configured: true,
        hasBackup: false,
        latest: { state: "unknown", at: "x" },
        next: null,
      },
      {
        configured: true,
        hasBackup: false,
        latest: { state: "ok", at: 123 },
        next: null,
      },
      { configured: true, hasBackup: false, latest: null, next: "later" },
      { configured: true, latest: null },
      { configured: true, latest: null, next: null },
      { configured: true, latest: null, next: null, hasBackup: "yes" },
    ]) {
      payload = value;
      const response = await GET();
      assert.equal(response.status, 503, JSON.stringify(value));
      assert.equal(
        await response.text(),
        '{"error":"Backup status unavailable."}',
      );
    }
  });
});
