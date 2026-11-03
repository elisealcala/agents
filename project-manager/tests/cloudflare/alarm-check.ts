/** Fixed local endpoint and synthetic snapshots only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateSnapshotPair } from "../../src/storage/snapshot.ts";
const [phase, directory] = process.argv.slice(2);
if (
  !directory ||
  !path.isAbsolute(directory) ||
  !["locked", "import", "rearm", "inspect"].includes(phase)
)
  throw new Error(
    "Usage: alarm-check.ts locked|import|rearm|inspect <fixture-directory>",
  );
const base = "http://127.0.0.1:8795";
const call = (route: string, init?: RequestInit) =>
  fetch(`${base}${route}`, init);
const schedule = () => call("/schedule", { method: "POST" });
const objects = async () =>
  (await (await call("/objects")).json()).objects as {
    key: string;
    body: string;
  }[];
const status = async () =>
  (await (await call("/status")).json()) as {
    configured: boolean;
    hasBackup: boolean;
    latest: { state: string; key?: string } | null;
    next: number | null;
  };
if (phase === "locked") {
  assert.equal((await schedule()).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const result = await status();
  assert.equal(result.configured, true);
  assert.equal(result.latest?.state, "error");
  assert.ok(result.next && result.next > Date.now());
  assert.equal((await objects()).length, 0);
} else if (phase === "import") {
  const pair = readFileSync(path.join(directory, "pair.json"), "utf8");
  const imported = await call("/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: pair,
  });
  assert.equal(imported.status, 200, await imported.text());
  assert.equal((await schedule()).status, 200);
  // Do not send requests while the platform alarm fires.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const result = await status();
  assert.equal(result.latest?.state, "ok");
  assert.equal(result.hasBackup, true);
  const download = await call("/latest");
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    await download.json(),
    JSON.parse(readFileSync(path.join(directory, "pair.json"), "utf8")),
  );
  assert.ok(result.next && result.next > Date.now() + 20 * 60 * 60 * 1000);
  const found = await objects();
  assert.equal(found.length, 1);
  assert.equal(found[0].key, result.latest?.key);
  const stored = JSON.parse(found[0].body);
  validateSnapshotPair(stored.manager, stored.evidence);
  assert.deepEqual(stored, JSON.parse(pair));
} else if (phase === "rearm") {
  assert.equal((await objects()).length, 1);
  assert.equal(
    (await call("/schedule?delay=6000", { method: "POST" })).status,
    200,
  );
} else {
  // The alarm was armed before stopping the Worker and became due while stopped.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const result = await status();
  assert.equal(result.latest?.state, "ok");
  assert.equal(result.hasBackup, true);
  const download = await call("/latest");
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    await download.json(),
    JSON.parse(readFileSync(path.join(directory, "pair.json"), "utf8")),
  );
  assert.ok(result.next && result.next > Date.now() + 20 * 60 * 60 * 1000);
  const found = await objects();
  assert.equal(found.length, 2);
  const latest = found.find((item) => item.key === result.latest?.key);
  assert.ok(latest);
  const stored = JSON.parse(latest.body);
  validateSnapshotPair(stored.manager, stored.evidence);
  assert.deepEqual(
    stored,
    JSON.parse(readFileSync(path.join(directory, "pair.json"), "utf8")),
  );
}
console.log(`${phase}: passed`);
