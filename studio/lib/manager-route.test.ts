import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

let actor: string | undefined = "123456";
mock.module(pathToFileURL(`${process.cwd()}/auth.ts`), {
  namedExports: {
    auth: async () => (actor ? { user: { id: actor } } : null),
  },
});
let POST: typeof import("../app/api/manager/[...path]/route.ts").POST;

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const context = { params: Promise.resolve({ path: ["projects.create"] }) };
const body = JSON.stringify({ name: "Fixture" });
function mutation(origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/manager/projects.create", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
  });
}

describe("manager mutation route", () => {
  let calls: Request[] = [];
  before(async () => {
    ({ POST } = await import("../app/api/manager/[...path]/route.ts"));
    Object.assign(process.env, {
      NODE_ENV: "test",
      MANAGER_HOSTED: "true",
      MANAGER_OWNER_ID: "123456",
      AUTH_SECRET: "fixture-secret-with-at-least-32-characters",
      AUTH_GITHUB_ID: "fixture-client",
      AUTH_GITHUB_SECRET: "fixture-secret",
      AUTH_URL: "http://localhost:3000",
      MANAGER_SERVICE_TOKEN: "fixture-service-token-with-32-characters",
      MANAGER_INTERNAL_URL: "http://127.0.0.1:8788",
    });
    globalThis.fetch = async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json({ result: { data: { id: "project-1" } } });
    };
  });
  after(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("rejects an absent or non-owner session before forwarding", async () => {
    for (const id of [undefined, "999999"]) {
      actor = id;
      calls = [];
      const response = await POST(mutation(), context);
      assert.equal(response.status, 401);
      assert.equal(calls.length, 0);
    }
    actor = "123456";
  });

  it("rejects a mutation from a different origin", async () => {
    calls = [];
    const response = await POST(mutation("https://other.example"), context);
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  });

  it("forwards an authenticated same-origin mutation and returns its result", async () => {
    calls = [];
    const response = await POST(mutation(), context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      result: { data: { id: "project-1" } },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8788/projects.create");
    assert.equal(calls[0].headers.get("x-manager-actor"), "123456");
    assert.equal(await calls[0].text(), body);
  });
});
