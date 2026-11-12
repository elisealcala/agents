// Hosted backup status/download checks (GH-111). Not run by the default `studio` test script.
// Run manually:
//   BACKUP_ORIGIN=https://project-manager.ezth.workers.dev \
//   node --import tsx --test studio/tests/manager/stage-2-backup.spec.ts
// Optional BACKUP_OWNER_COOKIE (never commit or print) enables owner checks.
// Optional BACKUP_NONOWNER_COOKIE enables the non-owner denial check.
// Backup bodies are checked in memory only and never printed or saved.
import assert from "node:assert/strict";
import { test } from "node:test";

const origin = process.env.BACKUP_ORIGIN;
const ownerCookie = process.env.BACKUP_OWNER_COOKIE;
const nonOwnerCookie = process.env.BACKUP_NONOWNER_COOKIE;
const skip =
  !origin || /localhost|127\.0\.0\.1|\[::1\]/.test(origin)
    ? "set BACKUP_ORIGIN to the deployed https origin"
    : false;
const skipOwner = skip || (ownerCookie ? false : "BACKUP_OWNER_COOKIE not set");
const skipNonOwner =
  skip || (nonOwnerCookie ? false : "BACKUP_NONOWNER_COOKIE not set");

const paths = ["/api/manager-backup", "/api/manager-backup/latest"];

function url(path: string) {
  return new URL(path, origin).toString();
}

function assertPrivate(res: Response) {
  const cc = (res.headers.get("cache-control") ?? "").toLowerCase();
  assert.ok(
    cc.includes("no-store") && cc.includes("private"),
    `cache-control was "${cc}"`,
  );
}

test("signed-out backup status and download are denied", { skip }, async () => {
  for (const path of paths) {
    const res = await fetch(url(path), { redirect: "manual" });
    assert.equal(res.status, 401, path);
    assertPrivate(res);
    await res.arrayBuffer();
  }
});

test("non-owner backup status and download are denied", {
  skip: skipNonOwner,
}, async () => {
  for (const path of paths) {
    const res = await fetch(url(path), {
      redirect: "manual",
      headers: { cookie: nonOwnerCookie! },
    });
    assert.ok([401, 403].includes(res.status), `${path} got ${res.status}`);
    assertPrivate(res);
    await res.arrayBuffer();
  }
});

test("owner sees a successful backup with a next wakeup", {
  skip: skipOwner,
}, async () => {
  const res = await fetch(url("/api/manager-backup"), {
    redirect: "manual",
    headers: { cookie: ownerCookie! },
  });
  assert.equal(res.status, 200);
  assertPrivate(res);
  const data = (await res.json()) as {
    configured?: boolean;
    hasBackup?: boolean;
    latest?: { state?: string; at?: string };
    next?: string;
  };
  assert.equal(data.configured, true);
  assert.equal(data.hasBackup, true);
  assert.equal(data.latest?.state, "ok");
  assert.ok(Number.isFinite(Date.parse(data.latest?.at ?? "")));
  assert.ok(Number.isFinite(Date.parse(data.next ?? "")));
});

test("owner downloads the last-good backup as a private attachment", {
  skip: skipOwner,
}, async () => {
  const res = await fetch(url("/api/manager-backup/latest"), {
    redirect: "manual",
    headers: { cookie: ownerCookie! },
  });
  assert.equal(res.status, 200);
  assertPrivate(res);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment/i);
  const body = await res.arrayBuffer();
  assert.ok(body.byteLength > 0);
});
