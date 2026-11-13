import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completeInstallCallback,
  createInstallState,
  outcomeResponse,
  verifyInstallState,
} from "./manager-github-app.ts";

const secret = "fixture-secret-with-at-least-32-characters";
const token = "fixture-service-token-0123456789-abc";

function binding(status: number, body: unknown, calls: Request[] = []) {
  return {
    idFromName: () => "id",
    get: () => ({
      fetch: async (request: Request) => {
        calls.push(request);
        return Response.json(body, { status });
      },
    }),
  };
}

async function run(
  overrides: Partial<Parameters<typeof completeInstallCallback>[0]>,
  b = binding(200, { connected: true }),
) {
  const { state, nonce } = await createInstallState(secret, "1");
  return completeInstallCallback({
    secret,
    token,
    owner: "1",
    actor: "1",
    search: new URLSearchParams({ state, installation_id: "42" }),
    cookieNonce: nonce,
    binding: b,
    ...overrides,
  });
}

describe("github app installation callback", () => {
  it("rejects missing, expired, tampered and foreign state", async () => {
    const { state, nonce } = await createInstallState(secret, "1", 0);
    assert.equal(await verifyInstallState(secret, "1", state, nonce, 1), true);
    assert.equal(await verifyInstallState(secret, "1", null, nonce), false);
    assert.equal(await verifyInstallState(secret, "1", state, null), false);
    assert.equal(await verifyInstallState(secret, "1", state, nonce), false);
    assert.equal(await verifyInstallState(secret, "2", state, nonce, 1), false);
    assert.equal(await verifyInstallState(secret, "1", state, "x", 1), false);
    assert.equal(
      await verifyInstallState(secret, "1", `${state}0`, nonce, 1),
      false,
    );
  });

  it("rejects another actor and forged installations", async () => {
    const calls: Request[] = [];
    assert.equal(
      await run({ actor: "2" }, binding(200, { connected: true }, calls)),
      "invalid-state",
    );
    assert.equal(
      await run({ search: new URLSearchParams({ installation_id: "42" }) }),
      "invalid-state",
    );
    assert.equal(calls.length, 0);
    assert.equal(await run({}, binding(403, { error: "no" })), "rejected");
    const { state, nonce } = await createInstallState(secret, "1");
    assert.equal(
      await run({
        search: new URLSearchParams({ state, installation_id: "abc" }),
        cookieNonce: nonce,
      }),
      "rejected",
    );
  });

  it("saves through the private service and exposes no secrets", async () => {
    const calls: Request[] = [];
    assert.equal(
      await run({}, binding(200, { connected: true }, calls)),
      "connected",
    );
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://manager.internal/trpc/connections/github-app",
    );
    assert.equal(calls[0].headers.get("authorization"), `Bearer ${token}`);
    assert.equal(await run({}, binding(500, { error: token })), "unavailable");
    for (const outcome of [
      "connected",
      "invalid-state",
      "rejected",
      "unavailable",
    ] as const) {
      const response = outcomeResponse(outcome);
      const text = await response.text();
      assert.doesNotMatch(text, /fixture|secret|token/i);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  });
});
