// Hosted auth checks (GH-109). Not run by the default `studio` test script.
// Real GitHub sign-in is done by a person in a clean browser; this spec only
// replays session cookies the person copies out. Never commit or print them.
//   AUTH_ORIGIN=https://project-manager.ezth.workers.dev \
//   AUTH_OWNER_COOKIE=...        (owner session)
//   AUTH_NON_OWNER_COOKIE=...    (session of a second real GitHub identity)
//   AUTH_EXPIRED_COOKIE=...      (owner cookie after expiry or sign-out)
//   node --import tsx --test studio/tests/manager/stage-2-auth.spec.ts
// Missing inputs skip with a reason: a skipped gate is incomplete, not passed.
import assert from "node:assert/strict";
import { test } from "node:test";

const origin = process.env.AUTH_ORIGIN;
const owner = process.env.AUTH_OWNER_COOKIE;
const nonOwner = process.env.AUTH_NON_OWNER_COOKIE;
const expired = process.env.AUTH_EXPIRED_COOKIE;

const skip =
  !origin || /localhost|127\.0\.0\.1|\[::1\]/.test(origin)
    ? "set AUTH_ORIGIN to the deployed https origin"
    : false;
const need = (value: string | undefined, name: string) =>
  skip || (value ? false : `${name} not set`);

const read = "/api/manager-backup";

function url(path: string) {
  return new URL(path, origin).toString();
}

function assertPrivate(res: Response) {
  const cc = (res.headers.get("cache-control") ?? "").toLowerCase();
  assert.ok(cc.includes("no-store") && cc.includes("private"), `cache-control "${cc}"`);
}

async function assertDenied(cookie: string | undefined, label: string) {
  const api = await fetch(url(read), {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  assert.ok([401, 403].includes(api.status), `${label} API got ${api.status}`);
  assertPrivate(api);
  const body = await api.text();
  assert.doesNotMatch(body, /"hasBackup"|"configured"|localhost|AUTH_SECRET|Error:/);

  const page = await fetch(url("/manager"), {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  assert.ok(page.status >= 300 && page.status < 400, `${label} page got ${page.status}`);
  const location = new URL(page.headers.get("location") ?? "", origin).pathname;
  assert.match(location, /^\/login/, `${label} redirected to ${location}`);
}

test("owner session reaches the protected API and page", { skip: need(owner, "AUTH_OWNER_COOKIE") }, async () => {
  const api = await fetch(url(read), { redirect: "manual", headers: { cookie: owner! } });
  assert.equal(api.status, 200);
  assertPrivate(api);
  const page = await fetch(url("/manager"), { redirect: "manual", headers: { cookie: owner! } });
  assert.equal(page.status, 200);
  assertPrivate(page);
  const session = await fetch(url("/api/auth/session"), { headers: { cookie: owner! } });
  assert.equal(session.status, 200);
});

test("a different real GitHub identity is denied", { skip: need(nonOwner, "AUTH_NON_OWNER_COOKIE (second real account)") }, async () => {
  await assertDenied(nonOwner, "non-owner");
});

test("expired or signed-out session is denied", { skip: need(expired, "AUTH_EXPIRED_COOKIE") }, async () => {
  await assertDenied(expired, "expired");
});

test("signed-out direct HTML and API access is denied", { skip }, async () => {
  await assertDenied(undefined, "signed-out");
});

test("callback without valid OAuth state does not sign in", { skip }, async () => {
  for (const query of ["", "?code=forged&state=forged"]) {
    const res = await fetch(url(`/api/auth/callback/github${query}`), { redirect: "manual" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.doesNotMatch(setCookie, /session-token=[^;]+/i, "session cookie issued");
    const location = res.headers.get("location");
    if (location) assert.equal(new URL(location, origin).origin, new URL(origin!).origin);
    const session = await fetch(url("/api/auth/session"));
    assert.equal(((await session.text()).trim()), "null");
  }
});

test("authenticated cross-origin mutation is rejected", { skip: need(owner, "AUTH_OWNER_COOKIE") }, async () => {
  for (const bad of ["https://evil.example", "null"]) {
    const res = await fetch(url("/api/manager-migration"), {
      method: "POST",
      redirect: "manual",
      headers: { cookie: owner!, origin: bad, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 403, `origin ${bad}`);
    assertPrivate(res);
  }
});
