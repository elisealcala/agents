import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  completeProjectsCallback,
  createProjectsState,
  manageProjectsConnection,
  outcomeResponse,
  resetConsumedProjectsNonces,
  verifyProjectsState,
} from "./manager-projects-auth.ts";

const secret = "fixture-secret-with-at-least-32-characters";
const token = "fixture-service-token-0123456789-abc";
const code = "fixture-oauth-code-123";
let calls: Request[] = [];
let reply: () => Response;
const binding = {
  idFromName: () => "id",
  get: () => ({
    fetch: async (request: Request) => {
      calls.push(request.clone());
      return reply();
    },
  }),
};
const ok = (scopes: string[]) => () =>
  Response.json({ connected: true, scopes });

async function callback(owner = "123", actor = "123", mutate?: string) {
  const { state, nonce } = await createProjectsState(secret, "123");
  return completeProjectsCallback({
    secret,
    token,
    owner,
    actor,
    binding,
    cookieNonce: mutate ?? nonce,
    search: new URLSearchParams({ state, code }),
  });
}

describe("projects authorization", () => {
  beforeEach(() => {
    calls = [];
    reply = ok(["project"]);
    resetConsumedProjectsNonces();
  });

  it("connects with valid state and required scope", async () => {
    assert.equal(await callback(), "connected");
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, "/trpc/connections/projects");
  });

  it("rejects replayed callbacks", async () => {
    const { state, nonce } = await createProjectsState(secret, "123");
    const input = {
      secret,
      token,
      owner: "123",
      actor: "123",
      binding,
      cookieNonce: nonce,
      search: new URLSearchParams({ state, code }),
    };
    assert.equal(await completeProjectsCallback(input), "connected");
    assert.equal(await completeProjectsCallback(input), "invalid-state");
    assert.equal(calls.length, 1);
  });

  it("rejects wrong owner, wrong browser, expiry and App-install state", async () => {
    assert.equal(await callback("123", "999"), "invalid-state");
    assert.equal(await callback("999", "999"), "invalid-state");
    assert.equal(await callback("123", "123", "deadbeef"), "invalid-state");
    const old = await createProjectsState(secret, "123", 0);
    assert.equal(
      await verifyProjectsState(secret, "123", old.state, old.nonce),
      false,
    );
    assert.equal(calls.length, 0);
  });

  it("keeps missing scope explicit", async () => {
    reply = ok(["read:user"]);
    assert.equal(await callback(), "missing-scope");
    assert.equal(outcomeResponse("missing-scope").status, 403);
  });

  it("refresh, rotate and disconnect touch only the Projects path", async () => {
    const input = { token, owner: "123", actor: "123", binding };
    assert.equal(await manageProjectsConnection(input, "refresh"), "connected");
    assert.equal(await manageProjectsConnection(input, "rotate"), "connected");
    reply = () => Response.json({ connected: false });
    assert.equal(
      await manageProjectsConnection(input, "disconnect"),
      "disconnected",
    );
    assert.deepEqual(
      calls.map((c) => new URL(c.url).pathname),
      [
        "/trpc/connections/projects/refresh",
        "/trpc/connections/projects/rotate",
        "/trpc/connections/projects/disconnect",
      ],
    );
    assert.equal(
      await manageProjectsConnection({ ...input, actor: "9" }, "rotate"),
      "invalid-state",
    );
  });

  it("never discloses credentials in outcomes", async () => {
    reply = () =>
      Response.json({ connected: true, scopes: ["project"], token: "gho_leak" });
    for (const outcome of [
      "connected",
      "disconnected",
      "invalid-state",
      "rejected",
      "missing-scope",
      "unavailable",
    ] as const) {
      const body = await outcomeResponse(outcome).text();
      assert.ok(!body.includes("gho_leak"));
      assert.ok(!body.includes(code));
      assert.ok(!body.includes(token));
    }
    reply = () => new Response("secret gho_leak", { status: 500 });
    assert.equal(await callback(), "unavailable");
  });
});
