import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

let actor: string | undefined;
let bindingMode: "available" | "missing" | "error";
let responseMode: "ok" | "reject" | "redirect" | "throw";
let calls: Request[] = [];
let ids: string[] = [];
const serviceToken = "fixture-service-token-0123456789-abc";
const migrationToken = "fixture-migration-token-0123456789-abc";
const body = JSON.stringify({ manager: { fixture: true }, evidence: {} });
mock.module(pathToFileURL(`${process.cwd()}/auth.ts`), {
  namedExports: { auth: async () => (actor ? { user: { id: actor } } : null) },
});
mock.module("@opennextjs/cloudflare", {
  namedExports: {
    getCloudflareContext: () => {
      if (bindingMode === "error") throw new Error("internal context failure");
      return {
        env: {
          MANAGER:
            bindingMode === "missing"
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
                        if (responseMode === "throw")
                          throw new Error("private backend details");
                        if (responseMode === "redirect")
                          return new Response(null, {
                            status: 302,
                            headers: { location: "https://other.example" },
                          });
                        if (responseMode === "reject")
                          return new Response("private backend details", {
                            status: 500,
                          });
                        return Response.json({ ok: true });
                      },
                    };
                  },
                },
        },
      };
    },
  },
});
let POST: typeof import("../app/api/manager-migration/route.ts").POST;
const originalEnv = { ...process.env };
function request(
  options: {
    origin?: string | null;
    length?: string;
    content?: string | ArrayBuffer;
  } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null)
    headers.set("origin", options.origin ?? "http://localhost:3000");
  if (options.length !== undefined)
    headers.set("content-length", options.length);
  return new Request("http://localhost:3000/api/manager-migration", {
    method: "POST",
    headers,
    body: options.content ?? body,
  });
}

describe("manager backup import route", () => {
  before(async () => {
    ({ POST } = await import("../app/api/manager-migration/route.ts"));
  });
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      MANAGER_HOSTED: "true",
      MANAGER_IMPORT_ENABLED: "true",
      MANAGER_OWNER_ID: "123456",
      AUTH_SECRET: "fixture-secret-with-at-least-32-characters",
      AUTH_GITHUB_ID: "fixture-client",
      AUTH_GITHUB_SECRET: "fixture-secret",
      AUTH_URL: "http://localhost:3000",
      MANAGER_SERVICE_TOKEN: serviceToken,
      MANAGER_MIGRATION_TOKEN: migrationToken,
    });
    actor = "123456";
    bindingMode = "available";
    responseMode = "ok";
    calls = [];
    ids = [];
  });
  after(() => {
    process.env = originalEnv;
  });

  it("is unavailable when hosted mode or importing is disabled", async () => {
    process.env.MANAGER_HOSTED = "false";
    assert.equal((await POST(request())).status, 404);
    process.env.MANAGER_HOSTED = "true";
    for (const value of ["false", "", "TRUE"]) {
      process.env.MANAGER_IMPORT_ENABLED = value;
      assert.equal((await POST(request())).status, 404);
    }
    assert.equal(calls.length, 0);
  });
  it("requires valid sign-in configuration and the configured owner", async () => {
    delete process.env.AUTH_SECRET;
    assert.equal((await POST(request())).status, 503);
    process.env.AUTH_SECRET = "fixture-secret-with-at-least-32-characters";
    for (const id of [undefined, "999999"]) {
      actor = id;
      const response = await POST(request());
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.equal(calls.length, 0);
  });
  it("rejects missing and untrusted origins", async () => {
    for (const origin of [null, "https://other.example", "null"]) {
      assert.equal((await POST(request({ origin }))).status, 403);
    }
    assert.equal(calls.length, 0);
  });
  it("fails closed when either credential is missing, short, or reused", async () => {
    for (const [service, migration] of [
      ["", migrationToken],
      ["short", migrationToken],
      [serviceToken, ""],
      [serviceToken, "short"],
      [serviceToken, serviceToken],
    ]) {
      process.env.MANAGER_SERVICE_TOKEN = service;
      process.env.MANAGER_MIGRATION_TOKEN = migration;
      const response = await POST(request());
      assert.equal(response.status, 503);
      assert.equal(
        await response.text(),
        '{"error":"Import is not configured."}',
      );
    }
    assert.equal(calls.length, 0);
  });
  it("rejects invalid or oversized declared length and oversized bodies", async () => {
    for (const length of ["nope", String(8 * 1024 * 1024 + 1)])
      assert.equal((await POST(request({ length }))).status, 413);
    const response = await POST(
      request({ content: new Uint8Array(8 * 1024 * 1024 + 1).buffer }),
    );
    assert.equal(response.status, 413);
    assert.equal(calls.length, 0);
  });
  it("does not fall back to network when the private binding is absent or inaccessible", async () => {
    for (const mode of ["missing", "error"] as const) {
      bindingMode = mode;
      const response = await POST(request());
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(
        await response.text(),
        '{"error":"Manager connection is unavailable."}',
      );
    }
    assert.equal(calls.length, 0);
  });
  it("sends an authenticated owner request to only the primary private manager", async () => {
    const response = await POST(
      request({ length: String(Buffer.byteLength(body)) }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(ids, ["primary"]);
    assert.equal(calls.length, 1);
    const forwarded = calls[0];
    assert.equal(forwarded.url, "https://manager.internal/migration/import");
    assert.equal(forwarded.method, "POST");
    assert.equal(forwarded.redirect, "manual");
    assert.equal(
      forwarded.headers.get("authorization"),
      `Bearer ${serviceToken}`,
    );
    assert.equal(forwarded.headers.get("x-manager-actor"), "123456");
    assert.equal(forwarded.headers.get("x-migration-token"), migrationToken);
    assert.equal(await forwarded.text(), body);
  });
  it("hides backend errors, rejects redirects and reports uncertain failures", async () => {
    for (const mode of ["reject", "redirect", "throw"] as const) {
      responseMode = mode;
      const response = await POST(request());
      assert.equal(response.status, mode === "throw" ? 503 : 409);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const text = await response.text();
      assert.doesNotMatch(
        text,
        /private backend details|other\.example|fixture-service|fixture-migration/,
      );
    }
    assert.equal(calls.length, 3);
  });
});
