// Hosted auth checks (GH-109), excluded from the default Studio test script.
//   AUTH_ORIGIN=https://project-manager.ezth.workers.dev \
//   node --import tsx --test tests/manager/stage-2-auth.spec.ts
// Optional AUTH_OWNER_COOKIE must come from real owner OAuth. Never print or commit it.
// A rejected non-owner receives no session cookie: record the actual OAuth denial
// in browser evidence. An arbitrary invalid cookie cannot prove that journey.
// For optional expired-token replay, first verify this exact cookie was a real
// owner session, record its observed-at and expiry, then leave that copy unchanged:
// AUTH_EXPIRED_COOKIE, AUTH_EXPIRED_COOKIE_OWNER_ID,
// AUTH_EXPIRED_COOKIE_VERIFIED_AT, AUTH_EXPIRED_COOKIE_EXPIRES_AT.
// Metadata is operator-supplied provenance, not independent proof of real OAuth.
// Sign-out/cookie deletion is NOT token expiry. Missing live inputs skip; skips
// leave the corresponding acceptance gate incomplete. Refresh/re-authentication
// mutation counts and natural browser expiry also require browser evidence.
import assert from "node:assert/strict";
import { test } from "node:test";

const stagingOrigin = "https://project-manager.ezth.workers.dev";
const ownerId = "16949569";
const lifetimeMs = 8 * 60 * 60 * 1000;
const expiryToleranceMs = 60 * 1000;

function checkedOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("AUTH_ORIGIN must be the canonical HTTPS staging origin.");
  }
  if (
    parsed.origin !== stagingOrigin ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("AUTH_ORIGIN must be the canonical HTTPS staging origin.");
  return parsed.origin;
}

function checkedExpiry(
  verifiedOwnerId: string | undefined,
  verifiedAt: string | undefined,
  expiresAt: string | undefined,
  now: number,
): void {
  const observed = Date.parse(verifiedAt ?? "");
  const expires = Date.parse(expiresAt ?? "");
  if (
    verifiedOwnerId !== ownerId ||
    !Number.isFinite(observed) ||
    !Number.isFinite(expires) ||
    observed >= expires ||
    expires - observed > lifetimeMs + expiryToleranceMs ||
    now < expires + expiryToleranceMs
  )
    throw new Error(
      "Expired replay requires a previously verified real owner cookie and an elapsed expiry (plus 60 seconds).",
    );
}

const origin = process.env.AUTH_ORIGIN
  ? checkedOrigin(process.env.AUTH_ORIGIN)
  : undefined;
const owner = process.env.AUTH_OWNER_COOKIE;
const expired = process.env.AUTH_EXPIRED_COOKIE;
if (process.env.AUTH_NON_OWNER_COOKIE !== undefined)
  throw new Error(
    "AUTH_NON_OWNER_COOKIE is unsupported; record a real non-owner OAuth denial in browser evidence.",
  );
if (expired)
  checkedExpiry(
    process.env.AUTH_EXPIRED_COOKIE_OWNER_ID,
    process.env.AUTH_EXPIRED_COOKIE_VERIFIED_AT,
    process.env.AUTH_EXPIRED_COOKIE_EXPIRES_AT,
    Date.now(),
  );

const skip = origin ? false : "set AUTH_ORIGIN to the canonical staging origin";
const need = (value: string | undefined, name: string) =>
  skip || (value ? false : `${name} not set`);

async function request(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(new URL(path, origin), {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Do not surface an underlying request/header dump containing a cookie.
    throw new Error(
      "Hosted auth request failed; request details are redacted.",
    );
  }
}

function assertPrivate(res: Response): void {
  const cc = (res.headers.get("cache-control") ?? "").toLowerCase();
  assert.ok(
    cc.includes("no-store") && cc.includes("private"),
    "response must be private and no-store",
  );
}

async function readSession(res: Response): Promise<{
  user?: { id?: unknown };
} | null> {
  try {
    return await res.json();
  } catch {
    throw new Error("Session response must be JSON; response is redacted.");
  }
}

async function assertDenied(cookie?: string): Promise<void> {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  for (const path of [
    "/api/manager/projects.list",
    "/api/manager-backup",
    "/api/manager-backup/latest",
  ]) {
    const res = await request(path, { headers });
    assert.ok(res.status === 401, "protected API must reject the session");
    assertPrivate(res);
    const body = await res.text();
    assert.ok(
      !/"hasBackup"|"configured"|localhost|AUTH_SECRET|Error:/.test(body),
      "denied API response must not expose private state or diagnostics",
    );
  }
  const page = await request("/manager", { headers });
  assert.ok(page.status === 307, "protected page must redirect to login");
  assertPrivate(page);
  assert.ok(
    page.headers.get("location") === "/login" ||
      page.headers.get("location") === `${origin}/login`,
    "protected page must redirect only to canonical login",
  );
  const session = await request("/api/auth/session", { headers });
  assert.ok(session.status === 200, "session endpoint must respond");
  assertPrivate(session);
  assert.ok(!(await readSession(session))?.user, "session must have no user");
}

test("acceptance configuration rejects unsafe destinations and premature expiry", () => {
  assert.equal(checkedOrigin(stagingOrigin), stagingOrigin);
  for (const invalid of [
    "not a URL",
    "http://project-manager.ezth.workers.dev",
    "https://localhost",
    "https://other.example",
    "https://user:secret@project-manager.ezth.workers.dev",
    `${stagingOrigin}/manager`,
    `${stagingOrigin}?token=secret`,
    `${stagingOrigin}#secret`,
  ])
    assert.throws(
      () => checkedOrigin(invalid),
      /canonical HTTPS staging origin/,
    );
  const verified = "2026-11-10T12:00:00.000Z";
  const expiry = "2026-11-10T20:00:00.000Z";
  const elapsed = Date.parse(expiry) + expiryToleranceMs;
  checkedExpiry(ownerId, verified, expiry, elapsed);
  for (const values of [
    [undefined, verified, expiry],
    ["999", verified, expiry],
    [ownerId, undefined, expiry],
    [ownerId, verified, "invalid"],
    [ownerId, expiry, verified],
    [ownerId, verified, "2026-11-11T20:00:00.000Z"],
  ])
    assert.throws(
      () => checkedExpiry(values[0], values[1], values[2], elapsed),
      /previously verified real owner cookie/,
    );
  assert.throws(
    () => checkedExpiry(ownerId, verified, expiry, elapsed - 1),
    /elapsed expiry/,
  );
});

test("real owner cookie reaches protected APIs and identifies the configured owner", {
  skip: need(owner, "AUTH_OWNER_COOKIE"),
}, async () => {
  assert.ok(owner, "owner cookie is required for this opt-in check");
  const headers = { cookie: owner };
  const session = await request("/api/auth/session", { headers });
  assert.ok(session.status === 200, "owner session endpoint must respond");
  assertPrivate(session);
  assert.ok(
    (await readSession(session))?.user?.id === ownerId,
    "session must identify the configured immutable owner ID",
  );
  for (const path of ["/api/manager-backup", "/manager"]) {
    const res = await request(path, { headers });
    assert.ok(res.status === 200, "owner must reach the protected resource");
    assertPrivate(res);
  }
});

test("previously verified real owner token is denied after its recorded expiry", {
  skip: need(expired, "AUTH_EXPIRED_COOKIE and verified expiry metadata"),
}, async () => {
  await assertDenied(expired);
});

test("signed-out direct HTML and API access is denied", { skip }, async () => {
  await assertDenied();
});

test("callback without valid OAuth state is rejected without a session cookie", {
  skip,
}, async () => {
  for (const query of ["", "?code=forged&state=forged"]) {
    const res = await request(`/api/auth/callback/github${query}`);
    assert.ok(
      res.status === 302,
      "invalid callback must redirect to auth error",
    );
    assertPrivate(res);
    const location = res.headers.get("location");
    let target: URL | undefined;
    try {
      if (location) target = new URL(location, origin);
    } catch {
      // The assertion below reports no untrusted redirect contents.
    }
    assert.ok(target, "invalid callback must supply an auth error redirect");
    assert.ok(
      target.origin === origin &&
        target.pathname === "/api/auth/error" &&
        ["Configuration", "OAuthCallbackError", "InvalidCheck"].includes(
          target.searchParams.get("error") ?? "",
        ),
      "invalid callback must reach a canonical OAuth error",
    );
    assert.ok(
      !/session-token(?:\.\d+)?=[^;\s,]+/i.test(
        res.headers.get("set-cookie") ?? "",
      ),
      "invalid callback must not issue a session cookie",
    );
  }
  const session = await request("/api/auth/session");
  assert.ok(session.status === 200, "session endpoint must respond");
  assert.ok(!(await readSession(session))?.user, "callback must not sign in");
});

test("authenticated cross-origin mutation is rejected", {
  skip: need(owner, "AUTH_OWNER_COOKIE"),
}, async () => {
  assert.ok(owner, "owner cookie is required for this opt-in check");
  for (const bad of ["https://evil.example", "null"]) {
    const res = await request("/api/manager-migration", {
      method: "POST",
      headers: {
        cookie: owner,
        origin: bad,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.ok(
      res.status === 403,
      "authenticated foreign origin must be denied",
    );
    assertPrivate(res);
  }
});
