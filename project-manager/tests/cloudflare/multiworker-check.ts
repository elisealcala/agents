/** Local-only two-Worker fixture. Never deploy these configs or use real data. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { encode } from "../../../studio/node_modules/next-auth/jwt.js";
import { EvidenceCoreStore } from "../../../ingest-classifier/src/evidence/core-store.ts";
import { nodeEvidenceDriver } from "../../../ingest-classifier/src/evidence/sql-driver.ts";
import { ManagerStore } from "../../src/storage/manager-store.ts";
import { captureSnapshot } from "../../src/storage/snapshot.ts";
import { createNodeSqlDriver } from "../../src/storage/sql-driver.ts";

const phase = process.argv[2];
const directory = process.argv[3];
if (
  !directory ||
  !path.isAbsolute(directory) ||
  !["prepare", "init", "inspect"].includes(phase)
)
  throw new Error(
    "Usage: multiworker-check.ts prepare|init|inspect <absolute-temp-directory>",
  );
const root = path.resolve(import.meta.dirname, "../../..");
const serviceToken = "fixture-service-token-0123456789-abcdefgh";
const migrationToken = "fixture-migration-token-0123456789-abcdef";
const authSecret = "fixture-auth-secret-0123456789-abcdefghijk";
const owner = "123456";
const origin = "https://manager.fixture";
const cookieName = "__Secure-authjs.session-token";
const vars = {
  MANAGER_SERVICE_TOKEN: serviceToken,
  MANAGER_OWNER_ID: owner,
  MANAGER_MIGRATION_TOKEN: migrationToken,
};
const sessionCookie = async (subject: string) =>
  `${cookieName}=${await encode({ token: { sub: subject, name: "Fixture owner" }, secret: authSecret, salt: cookieName, maxAge: 3600 })}`;
const address = "http://127.0.0.1:8794";
const file = (name: string) => path.join(directory, name);
if (phase === "prepare") {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const base = {
    compatibility_date: "2026-10-30",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
  };
  const manager = {
    ...base,
    name: "agents-manager-storage-staging",
    main: path.join(root, "project-manager/src/cloudflare/worker.ts"),
    vars: { ...vars, MANAGER_IMPORT_MODE: "required" },
    durable_objects: {
      bindings: [
        { name: "MANAGER", class_name: "DurableManagerObject" },
        { name: "EVIDENCE", class_name: "DurableEvidenceObject" },
      ],
    },
    migrations: [
      { tag: "v1", new_sqlite_classes: ["DurableManagerObject"] },
      { tag: "v2", new_sqlite_classes: ["DurableEvidenceObject"] },
    ],
  };
  const studio = {
    ...base,
    name: "agents-manager-staging",
    main: path.join(root, "studio/.open-next/worker.js"),
    vars: {
      ...vars,
      MANAGER_IMPORT_ENABLED: "true",
      MANAGER_HOSTED: "true",
      AUTH_URL: origin,
      AUTH_SECRET: authSecret,
      AUTH_GITHUB_ID: "synthetic-client",
      AUTH_GITHUB_SECRET: "synthetic-client-secret",
      AUTH_TRUST_HOST: "true",
    },
    assets: {
      directory: path.join(root, "studio/.open-next/assets"),
      binding: "ASSETS",
    },
    durable_objects: {
      bindings: [
        {
          name: "MANAGER",
          class_name: "DurableManagerObject",
          script_name: "agents-manager-storage-staging",
        },
      ],
    },
  };
  const managerDb = new DatabaseSync(":memory:");
  const evidenceDb = new DatabaseSync(":memory:");
  try {
    managerDb.exec("PRAGMA foreign_keys = ON");
    evidenceDb.exec("PRAGMA foreign_keys = ON");
    const managerDriver = createNodeSqlDriver(managerDb);
    const evidenceDriver = createNodeSqlDriver(evidenceDb);
    const managerStore = new ManagerStore(managerDriver);
    const evidenceStore = new EvidenceCoreStore(nodeEvidenceDriver(evidenceDb));
    const project = managerStore.create("Synthetic cross-worker project");
    const evidence = evidenceStore.register({
      projectId: project.id,
      sourceId: "fixture-note",
      sourceVersion: "v1",
      idempotencyKey: "fixture-retry",
      markdown: "Cross-worker evidence 😀",
      sourceDate: "2026-11-02",
    });
    evidenceStore.ensureChunks(evidence);
    project.notes.push({
      id: "fixture-note",
      sourceId: evidence.sourceId,
      sourceVersion: evidence.sourceVersion,
      markdown: evidence.markdown,
      sourceDate: evidence.sourceDate,
      checksum: evidence.checksum,
      documentRef: evidence.documentRef,
      status: "review",
      indexStatus: "ready",
      runId: "fixture-run",
      error: null,
    });
    managerStore.save(project);
    const pair = {
      manager: captureSnapshot(managerDriver, "manager"),
      evidence: captureSnapshot(evidenceDriver, "evidence"),
    };
    for (const [name, data] of [
      ["studio.json", studio],
      ["manager.json", manager],
      ["pair.json", pair],
      [
        "reference.json",
        {
          projectId: project.id,
          documentRef: evidence.documentRef,
          checksum: evidence.checksum,
        },
      ],
    ] as const)
      writeFileSync(file(name), JSON.stringify(data), {
        mode: 0o600,
        flag: "wx",
      });
  } finally {
    managerDb.close();
    evidenceDb.close();
  }
  console.log("prepare: passed");
} else {
  const pair = readFileSync(file("pair.json"), "utf8");
  const reference = JSON.parse(readFileSync(file("reference.json"), "utf8"));
  const cookie = await sessionCookie(owner);
  const request = (cookieValue?: string, requestOrigin = origin) =>
    fetch(`${address}/api/manager-migration`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: requestOrigin,
        ...(cookieValue ? { cookie: cookieValue } : {}),
      },
      body: pair,
    });
  if (phase === "init") {
    assert.equal((await request()).status, 401);
    assert.equal((await request(await sessionCookie("999999"))).status, 401);
    assert.equal(
      (await request(cookie, "https://attacker.example")).status,
      403,
    );
    const unauthenticated = await fetch(`${address}/api/manager/projects.list`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(
      unauthenticated.headers.get("cache-control"),
      "private, no-store",
    );
    const before = await fetch(`${address}/api/manager/projects.list`, {
      headers: { cookie },
    });
    assert.equal(before.status, 503);
    const imported = await request(cookie);
    assert.equal(imported.status, 200, await imported.text());
  }
  const input = encodeURIComponent(
    JSON.stringify({
      projectId: reference.projectId,
      documentRef: reference.documentRef,
    }),
  );
  const source = await fetch(
    `${address}/api/manager/evidence.read?input=${input}`,
    { headers: { cookie } },
  );
  const denied = await fetch(
    `${address}/api/manager/evidence.read?input=${input}`,
  );
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  assert.equal(source.status, 200, await source.clone().text());
  const data = (await source.json()).result.data;
  assert.equal(data.documentRef, reference.documentRef);
  assert.equal(data.checksum, reference.checksum);
  assert.equal(data.markdown, "Cross-worker evidence 😀");
  console.log(`${phase}: passed`);
}
