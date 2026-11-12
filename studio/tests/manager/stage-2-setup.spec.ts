// Hosted degraded setup checks (GH-113). Not run by the default `studio` test script.
// Run manually:
//   SETUP_ORIGIN=https://project-manager.ezth.workers.dev \
//   node --import tsx --test studio/tests/manager/stage-2-setup.spec.ts
// Optional SETUP_OWNER_COOKIE (session cookie, never commit or print) enables owner checks.
import assert from "node:assert/strict";
import { test } from "node:test";

const origin = process.env.SETUP_ORIGIN;
const ownerCookie = process.env.SETUP_OWNER_COOKIE;
const skip =
  !origin || /localhost|127\.0\.0\.1|\[::1\]/.test(origin)
    ? "set SETUP_ORIGIN to the deployed https origin"
    : false;
const skipOwner = skip || (ownerCookie ? false : "SETUP_OWNER_COOKIE not set");

const unsafe =
  /localhost|127\.0\.0\.1|\bat .+\(.+:\d+:\d+\)|Error:|AUTH_SECRET|AUTH_GITHUB_SECRET|MANAGER_(SERVICE|MIGRATION)_TOKEN|manager\.internal|local manager|local agent/i;

function assertPrivate(res: Response) {
  const cc = (res.headers.get("cache-control") ?? "").toLowerCase();
  assert.ok(
    cc.includes("no-store") && cc.includes("private"),
    `cache-control was "${cc}"`,
  );
}

test("signed-out setup configuration is denied and safe", {
  skip,
}, async () => {
  const res = await fetch(
    new URL("/api/manager/agent.configuration", origin).toString(),
    { redirect: "manual" },
  );
  assert.equal(res.status, 401);
  assertPrivate(res);
  assert.doesNotMatch(await res.text(), unsafe);
});

test("owner setup reports missing providers without local services", {
  skip: skipOwner,
}, async () => {
  const res = await fetch(
    new URL("/api/manager/agent.configuration", origin).toString(),
    { redirect: "manual", headers: { cookie: ownerCookie! } },
  );
  assert.equal(res.status, 200);
  assertPrivate(res);
  const text = await res.text();
  assert.doesNotMatch(text, unsafe);
  const body = JSON.stringify(JSON.parse(text));
  assert.match(body, /unconfigured/);
  assert.doesNotMatch(body, /"(model|intake|conversation)":"configured"/);
});

test("owner setup page is served without local references", {
  skip: skipOwner,
}, async () => {
  const res = await fetch(new URL("/manager", origin).toString(), {
    redirect: "manual",
    headers: { cookie: ownerCookie! },
  });
  assert.equal(res.status, 200);
  assertPrivate(res);
});
