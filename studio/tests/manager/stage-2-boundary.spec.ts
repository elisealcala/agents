// Hosted boundary checks (GH-108). Not run by the default `studio` test script.
// Run manually:
//   BOUNDARY_ORIGIN=https://project-manager.ezth.workers.dev \
//   BOUNDARY_STORAGE_ORIGIN=https://agents-manager-storage-staging.ezth.workers.dev \
//   node --import tsx --test studio/tests/manager/stage-2-boundary.spec.ts
// Optional BOUNDARY_OWNER_COOKIE (session cookie, never commit or print) enables owner checks.
import assert from "node:assert/strict";
import { test } from "node:test";

const origin = process.env.BOUNDARY_ORIGIN;
const storageOrigin = process.env.BOUNDARY_STORAGE_ORIGIN;
const ownerCookie = process.env.BOUNDARY_OWNER_COOKIE;
const skip =
  !origin || /localhost|127\.0\.0\.1|\[::1\]/.test(origin)
    ? "set BOUNDARY_ORIGIN to the deployed https origin"
    : false;
const skipStorage =
  skip || !storageOrigin ? skip || "set BOUNDARY_STORAGE_ORIGIN" : false;
const skipOwner =
  skip || (ownerCookie ? false : "BOUNDARY_OWNER_COOKIE not set");

const reads = ["/api/manager/projects.list", "/api/manager-backup"];
const forged = {
  "x-manager-actor": "attacker",
  "x-manager-owner-id": "16949569",
  "x-manager-service-token": "forged",
  "x-manager-target": "https://example.invalid",
  "x-forwarded-host": "localhost:8788",
  authorization: "Bearer forged",
};

function url(path: string, base = origin) {
  return new URL(path, base).toString();
}

function assertPrivate(res: Response) {
  const cc = (res.headers.get("cache-control") ?? "").toLowerCase();
  assert.ok(
    cc.includes("no-store") && cc.includes("private"),
    `cache-control was "${cc}"`,
  );
}

async function assertSafeBody(res: Response) {
  const text = await res.text();
  assert.doesNotMatch(
    text,
    /localhost|127\.0\.0\.1|\bat .+\(.+:\d+:\d+\)|Error:|AUTH_SECRET|AUTH_GITHUB_SECRET|MANAGER_(SERVICE|MIGRATION)_TOKEN|manager\.internal/,
  );
  return text;
}

test("signed-out reads are denied and private", { skip }, async () => {
  for (const path of reads) {
    const res = await fetch(url(path), { redirect: "manual" });
    assert.equal(res.status, 401, path);
    assertPrivate(res);
    await assertSafeBody(res);
  }
});

test("signed-out mutations are denied", { skip }, async () => {
  for (const path of [
    "/api/manager-migration",
    "/api/manager/projects.create",
  ]) {
    const res = await fetch(url(path), {
      method: "POST",
      redirect: "manual",
      headers: { origin: origin!, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 401, path);
    assertPrivate(res);
    await assertSafeBody(res);
  }
});

test("forged identity and target headers do not grant access", {
  skip,
}, async () => {
  for (const path of reads) {
    const res = await fetch(url(path), { redirect: "manual", headers: forged });
    assert.equal(res.status, 401, path);
    assertPrivate(res);
    await assertSafeBody(res);
  }
  const mutation = await fetch(url("/api/manager-migration"), {
    method: "POST",
    redirect: "manual",
    headers: { ...forged, origin: origin!, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(mutation.status, 401);
  await assertSafeBody(mutation);
});

test("direct storage endpoints are not the manager", {
  skip: skipStorage,
}, async () => {
  for (const path of [
    "/",
    "/backup/status",
    "/migration/import",
    "/trpc/projects.list",
  ]) {
    for (const method of ["GET", "POST"] as const) {
      const res = await fetch(url(path, storageOrigin), {
        method,
        redirect: "manual",
        headers: forged,
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(res.status, 404, `${method} ${path}`);
      const text = await res.text();
      assert.doesNotMatch(
        text,
        /"configured"|"hasBackup"|projects\.list|AUTH_SECRET/,
      );
    }
  }
});

test("owner cross-origin mutations fail after authentication", {
  skip: skipOwner,
}, async () => {
  for (const bad of ["https://evil.example", "null"]) {
    const res = await fetch(url("/api/manager-migration"), {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: ownerCookie!,
        origin: bad,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(res.status, 403, `origin ${bad} got ${res.status}`);
    assertPrivate(res);
    await assertSafeBody(res);
  }
});

test("owner same-origin backup reaches the binding and ignores forged headers", {
  skip: skipOwner,
}, async () => {
  const res = await fetch(url("/api/manager-backup"), {
    redirect: "manual",
    headers: { cookie: ownerCookie!, ...forged },
  });
  assert.equal(res.status, 200);
  assertPrivate(res);
  const text = await assertSafeBody(res);
  const data = JSON.parse(text) as {
    configured?: unknown;
    hasBackup?: unknown;
  };
  assert.equal(typeof data.configured, "boolean");
  assert.equal(typeof data.hasBackup, "boolean");
});
