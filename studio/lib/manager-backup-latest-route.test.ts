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
  | "http-error";
let body: string;
let calls: Request[] = [];
let ids: string[] = [];
const token = "fixture-service-token-0123456789-abc";
mock.module(pathToFileURL(`${process.cwd()}/auth.ts`), {
  namedExports: { auth: async () => (actor ? { user: { id: actor } } : null) },
});
mock.module("@opennextjs/cloudflare", {
  namedExports: {
    getCloudflareContext: () => {
      if (mode === "context-error") throw new Error("private context");
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
                          throw new Error("private backend");
                        if (mode === "redirect")
                          return new Response(null, {
                            status: 302,
                            headers: { location: "https://other.example" },
                          });
                        if (mode === "http-error")
                          return new Response("private backend", {
                            status: 500,
                          });
                        return new Response(body, {
                          headers: { "Content-Type": "application/json" },
                        });
                      },
                    };
                  },
                },
        },
      };
    },
  },
});
let GET: typeof import("../app/api/manager-backup/latest/route.ts").GET;
const originalEnv = { ...process.env };

describe("manager latest backup download route", () => {
  before(async () => {
    ({ GET } = await import("../app/api/manager-backup/latest/route.ts"));
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
    body = JSON.stringify({
      manager: { kind: "manager", fixture: "😀" },
      evidence: { kind: "evidence" },
    });
    calls = [];
    ids = [];
  });
  after(() => {
    process.env = originalEnv;
  });

  it("requires hosted mode, valid login configuration and the configured owner", async () => {
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

  it("returns the original bytes from only the primary private binding as a private attachment", async () => {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(
      response.headers.get("content-disposition"),
      "attachment; filename=manager-backup.json",
    );
    assert.equal(await response.text(), body);
    assert.deepEqual(ids, ["primary"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://manager.internal/backup/latest");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].redirect, "manual");
    assert.equal(calls[0].headers.get("authorization"), `Bearer ${token}`);
    assert.equal(calls[0].headers.get("x-manager-actor"), "123456");
  });

  it("fails closed for invalid credentials and private binding or backend errors", async () => {
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
    ] as const) {
      mode = value;
      const response = await GET();
      assert.equal(response.status, 503, value);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(await response.text(), '{"error":"Backup is unavailable."}');
    }
  });

  it("rejects invalid JSON, missing parts and oversized responses", async () => {
    for (const value of [
      "invalid json",
      "null",
      "[]",
      JSON.stringify({ manager: {} }),
      JSON.stringify({ evidence: {} }),
      JSON.stringify({
        manager: {},
        evidence: {},
        oversized: "a".repeat(8 * 1024 * 1024),
      }),
    ]) {
      body = value;
      const response = await GET();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(await response.text(), '{"error":"Backup is unavailable."}');
    }
  });
});
