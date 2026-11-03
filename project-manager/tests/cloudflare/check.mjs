import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const [phase] = process.argv.slice(2);
const phases = [
  "disabled",
  "init",
  "inspect",
  "recover",
  "service-unauthorized",
  "service-config",
  "service-create",
  "service-inspect",
  "evidence-init",
  "evidence-inspect",
  "binding-create",
  "binding-read",
  "binding-unauthorized",
  "snapshot-init",
  "snapshot-inspect",
  "hosted-evidence-init",
  "hosted-evidence-inspect",
  "migration-init",
  "migration-resume",
  "migration-inspect",
];
assert.ok(phases.includes(phase), `Expected one of: ${phases.join(", ")}`);
// This checker intentionally cannot target a remote server or a different port.
const url = new URL("http://127.0.0.1:8793/");
const fixtureToken = "fixture-service-token-0123456789-abcdefgh";
const headers = {
  authorization: `Bearer ${fixtureToken}`,
  "x-manager-actor": "123456",
};
let options;
if (phase.startsWith("service-")) {
  const procedure =
    phase === "service-config"
      ? "agent.configuration"
      : phase === "service-create"
        ? "projects.create"
        : "projects.list";
  url.pathname = `/trpc/${procedure}`;
  if (phase === "service-create") {
    options = {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Synthetic durable manager" }),
    };
  } else if (phase !== "service-unauthorized") options = { headers };
} else if (phase !== "disabled") url.searchParams.set("action", phase);
const response = await fetch(url, options);
if (phase === "disabled") {
  assert.equal(response.status, 404);
  const service = await fetch(new URL("/trpc/projects.list", url));
  assert.equal(service.status, 404);
  const evidence = await fetch(new URL("/?action=evidence-init", url));
  assert.equal(evidence.status, 404);
  const binding = await fetch(new URL("/?action=binding-create", url));
  assert.equal(binding.status, 404);
  const snapshot = await fetch(new URL("/?action=snapshot-init", url));
  assert.equal(snapshot.status, 404);
  const hosted = await fetch(new URL("/?action=hosted-evidence-init", url));
  assert.equal(hosted.status, 404);
  assert.equal(
    (await fetch(new URL("/?action=migration-init", url))).status,
    404,
  );
} else if (phase === "service-unauthorized") {
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
} else if (phase.startsWith("migration-")) {
  assert.equal(response.status, 200);
  const data = await response.json();
  if (phase === "migration-init") {
    assert.equal(data.before, 503);
    assert.equal(data.wrong, 404);
    assert.equal(data.imported, 409);
    assert.equal(data.after, 503);
    assert.equal(data.read, 503);
  } else {
    if (phase === "migration-resume") {
      assert.equal(data.before, 503);
      assert.equal(data.imported, 200);
    } else assert.equal(data.before, 200);
    assert.equal(data.after, 200);
    assert.equal(data.read, 200);
    assert.equal(data.body.result.data.documentRef, data.documentRef);
    assert.equal(data.body.result.data.checksum, data.checksum);
    assert.equal(data.body.result.data.markdown, "Hosted fixture 😀 evidence");
  }
} else if (
  phase === "hosted-evidence-init" ||
  phase === "hosted-evidence-inspect"
) {
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.unauthorized, 401);
  assert.ok(data.other >= 400);
  assert.equal(data.success, 200);
  assert.equal(
    data.body.result.data.projectId,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(data.body.result.data.sourceId, "hosted-source");
  assert.equal(data.body.result.data.documentRef, data.documentRef);
  assert.equal(data.body.result.data.checksum, data.checksum);
  assert.equal(data.body.result.data.markdown, "Hosted fixture 😀 evidence");
} else if (phase === "snapshot-init" || phase === "snapshot-inspect") {
  assert.equal(response.status, 200);
  const data = await response.json();
  for (const kind of ["manager", "evidence"]) {
    assert.match(data[kind].source, /^[a-f0-9]{64}$/);
    if (phase === "snapshot-init") {
      assert.equal(data[kind].failed, 400);
      assert.equal(data[kind].before, data[kind].afterFailed);
      assert.equal(data[kind].restored, 200);
    } else assert.equal(data[kind].target, data[kind].source);
  }
} else if (phase === "binding-unauthorized") {
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
} else if (phase === "binding-create" || phase === "binding-read") {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = (await response.json()).result.data;
  const project = phase === "binding-create" ? data : data[0];
  if (phase === "binding-read") assert.equal(data.length, 1);
  assert.equal(project.name, "Synthetic binding project");
  assert.equal(project.revision, 0);
  assert.ok(project.id);
} else if (phase.startsWith("evidence-")) {
  assert.equal(response.status, 200);
  const data = await response.json();
  const markdown = `${"a".repeat(1499)}😀end`;
  const expectedHash = createHash("sha256").update(markdown).digest("hex");
  assert.equal(data.records.length, 1);
  const record = data.records[0];
  assert.equal(record.projectId, "project-one");
  assert.equal(record.sourceId, "note-one");
  assert.equal(record.sourceVersion, "1");
  assert.equal(record.checksum, expectedHash);
  assert.equal(record.markdown, markdown);
  assert.ok(record.documentRef);
  assert.deepEqual(data.marker, {
    documentRef: record.documentRef,
    sourceId: record.sourceId,
    checksum: record.checksum,
  });
  assert.equal(data.other, null);
  assert.deepEqual(data.otherChunks, []);
  assert.equal(data.chunks.length, 2);
  let start = 0;
  for (const chunk of data.chunks) {
    assert.equal(chunk.start, start);
    assert.equal(chunk.record.documentRef, record.documentRef);
    assert.equal(chunk.record.checksum, expectedHash);
    const passage = markdown.slice(chunk.start, chunk.end);
    assert.equal(Buffer.from(passage, "utf8").toString("utf8"), passage);
    start = chunk.end;
  }
  assert.equal(start, markdown.length);
  if (phase === "evidence-init") {
    assert.equal(data.duplicateSame, true);
    assert.equal(data.conflictKey, true);
    assert.equal(data.conflictVersion, true);
  }
} else if (phase.startsWith("service-")) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = (await response.json()).result.data;
  if (phase === "service-config")
    assert.deepEqual(data, {
      evidence: "unconfigured",
      model: "unconfigured",
      intake: "unconfigured",
      conversation: "unconfigured",
    });
  if (phase === "service-create") {
    assert.equal(data.name, "Synthetic durable manager");
    assert.equal(data.revision, 0);
    assert.ok(data.id);
  }
  if (phase === "service-inspect") {
    assert.equal(data.length, 1);
    assert.equal(data[0].name, "Synthetic durable manager");
    assert.equal(data[0].revision, 0);
  }
} else {
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.outbox.length, 1);
  assert.equal(data.outbox[0].id, "one");
  if (phase === "init" || phase === "inspect") {
    assert.equal(data.repo.revision, 1);
    assert.equal(data.repo.status, "in_progress");
    assert.equal(data.outbox[0].status, "dispatching");
    if (phase === "init") assert.equal(data.rolledBack, true);
  } else {
    assert.equal(data.recovered, 1);
    assert.equal(data.staleRejected, true);
    assert.equal(data.outbox[0].status, "unknown");
    assert.equal(data.outbox[0].attempt_id, null);
  }
}
console.log(`${phase}: passed`);
