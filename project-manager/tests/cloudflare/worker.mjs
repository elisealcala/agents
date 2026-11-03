// Local-only integration fixture. Never configure FIXTURE_ACCESS on a deployment.
import { dispatchManagerRequest } from "../../../studio/lib/manager-transport.ts";
import { DurableManagerObject } from "../../src/cloudflare/manager-object.ts";
import { DurableEvidenceObject } from "../../src/cloudflare/evidence-object.ts";
import { DurableEvidenceStore } from "../../../ingest-classifier/src/evidence/durable-store.ts";
import { DeliveryStore } from "../../src/storage/delivery-store.ts";
import { DurableManagerStore } from "../../src/storage/durable-manager-store.ts";
import {
  captureSnapshot,
  restoreSnapshot,
} from "../../src/storage/snapshot.ts";
import { createDurableSqlDriver } from "../../src/storage/sql-driver.ts";

const enabled = (env) => env.FIXTURE_ACCESS === "local-test-only";
const migrationToken = "fixture-migration-token-0123456789-abcdef";
const unavailable = () => new Response("Not found", { status: 404 });

export class Probe {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (!enabled(this.env)) return unavailable();
    const incomingUrl = new URL(request.url);
    if (incomingUrl.pathname.startsWith("/stage2-evidence/")) {
      this.migrationEvidence ??= new DurableEvidenceObject(this.ctx, {
        ...this.env,
        MANAGER_MIGRATION_TOKEN: migrationToken,
      });
      incomingUrl.pathname = incomingUrl.pathname.replace(
        "/stage2-evidence",
        "",
      );
      return this.migrationEvidence.fetch(new Request(incomingUrl, request));
    }
    if (incomingUrl.pathname.startsWith("/stage2-manager/")) {
      if (incomingUrl.searchParams.get("loseAck") === "1")
        this.loseMigrationAck = true;
      this.migrationManager ??= new DurableManagerObject(this.ctx, {
        MANAGER_SERVICE_TOKEN: this.env.MANAGER_SERVICE_TOKEN,
        MANAGER_OWNER_ID: this.env.MANAGER_OWNER_ID,
        MANAGER_MIGRATION_TOKEN: migrationToken,
        MANAGER_IMPORT_MODE: "required",
        EVIDENCE: {
          idFromName: (name) => name,
          get: () => ({
            fetch: async (req) => {
              const target = new URL(req.url);
              const path = target.pathname;
              target.pathname = `/stage2-evidence${path}`;
              const response = await this.env.PROBE.get(
                this.env.PROBE.idFromName("migration-target-evidence"),
              ).fetch(new Request(target, req));
              if (
                path === "/migration/restore" &&
                response.ok &&
                this.loseMigrationAck
              ) {
                this.loseMigrationAck = false;
                throw new Error("Synthetic lost acknowledgement");
              }
              return response;
            },
          }),
        },
      });
      incomingUrl.pathname = incomingUrl.pathname.replace(
        "/stage2-manager",
        "",
      );
      incomingUrl.searchParams.delete("loseAck");
      return this.migrationManager.fetch(new Request(incomingUrl, request));
    }
    if (incomingUrl.pathname === "/read") {
      this.evidenceService ??= new DurableEvidenceObject(this.ctx, this.env);
      return this.evidenceService.fetch(request);
    }
    if (incomingUrl.pathname.startsWith("/hosted-manager/trpc/")) {
      this.hostedManager ??= new DurableManagerObject(this.ctx, {
        MANAGER_SERVICE_TOKEN: this.env.MANAGER_SERVICE_TOKEN,
        MANAGER_OWNER_ID: this.env.MANAGER_OWNER_ID,
        EVIDENCE: {
          idFromName: (name) => name,
          get: () =>
            this.env.PROBE.get(
              this.env.PROBE.idFromName("hosted-evidence-owner"),
            ),
        },
      });
      incomingUrl.pathname = incomingUrl.pathname.replace(
        "/hosted-manager",
        "",
      );
      return this.hostedManager.fetch(new Request(incomingUrl, request));
    }
    if (incomingUrl.pathname === "/hosted-fixture") {
      const mode = incomingUrl.searchParams.get("mode");
      if (mode === "evidence-init") {
        const store = new DurableEvidenceStore(this.ctx.storage);
        return Response.json(
          store.register({
            projectId: "00000000-0000-4000-8000-000000000001",
            sourceId: "hosted-source",
            sourceVersion: "1",
            idempotencyKey: "hosted-key",
            markdown: "Hosted fixture 😀 evidence",
            sourceDate: "2026-11-02",
          }),
        );
      }
      if (mode === "evidence-info") {
        const store = new DurableEvidenceStore(this.ctx.storage);
        return Response.json(
          store.list("00000000-0000-4000-8000-000000000001")[0] ?? null,
        );
      }
      if (mode === "manager-init" && request.method === "POST") {
        const record = await request.json();
        const store = new DurableManagerStore(this.ctx.storage);
        const project = {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Hosted fixture",
          revision: 0,
          createdAt: "2026-11-02T00:00:00.000Z",
          notes: [
            {
              id: "hosted-note",
              sourceId: record.sourceId,
              sourceVersion: record.sourceVersion,
              markdown: record.markdown,
              sourceDate: record.sourceDate,
              checksum: record.checksum,
              documentRef: record.documentRef,
              status: "review",
              indexStatus: "ready",
              runId: "hosted-run",
              error: null,
            },
          ],
          candidates: [],
          approved: [],
          history: [],
          reviews: [],
          conversations: [],
        };
        store.save(project);
        store.save({
          ...project,
          id: "00000000-0000-4000-8000-000000000002",
          notes: [],
        });
        return Response.json({ ok: true });
      }
      return unavailable();
    }
    if (new URL(request.url).pathname.startsWith("/trpc/")) {
      this.service ??= new DurableManagerObject(this.ctx, {
        MANAGER_SERVICE_TOKEN: this.env.MANAGER_SERVICE_TOKEN,
        MANAGER_OWNER_ID: this.env.MANAGER_OWNER_ID,
      });
      return this.service.fetch(request);
    }
    const url = new URL(request.url);
    if (url.pathname === "/snapshot") {
      const kind = url.searchParams.get("kind");
      const mode = url.searchParams.get("mode");
      if (!["manager", "evidence"].includes(kind)) return unavailable();
      const driver = createDurableSqlDriver(this.ctx.storage);
      if (kind === "manager") new DurableManagerStore(this.ctx.storage);
      else new DurableEvidenceStore(this.ctx.storage);
      if (mode === "init" && request.method === "GET") {
        if (kind === "manager") {
          driver
            .prepare("INSERT INTO projects (id, data) VALUES (?, ?)")
            .run(
              "snapshot-project",
              JSON.stringify({ id: "snapshot-project", notes: [] }),
            );
          driver
            .prepare(
              "INSERT INTO delivery_repositories (id, identity, revision, status) VALUES (?, ?, ?, ?)",
            )
            .run("snapshot-repo", "{}", 1, "ready");
          driver
            .prepare(
              "INSERT INTO delivery_jobs (id, repository_id, kind, status, attempt_id, lease_expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(
              "snapshot-job",
              "snapshot-repo",
              "fixture",
              "queued",
              null,
              null,
            );
        } else {
          const evidence = new DurableEvidenceStore(this.ctx.storage);
          const record = evidence.register({
            projectId: "snapshot-project",
            sourceId: "snapshot-note",
            sourceVersion: "1",
            idempotencyKey: "snapshot-key",
            markdown: "Snapshot 😀 contents",
            sourceDate: "2026-11-02",
          });
          evidence.ensureChunks(record);
        }
        return Response.json(captureSnapshot(driver, kind));
      }
      if (mode === "capture" && request.method === "GET")
        return Response.json(captureSnapshot(driver, kind));
      if (mode === "restore" && request.method === "POST") {
        try {
          restoreSnapshot(driver, await request.json());
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json(
            { ok: false, error: String(error) },
            { status: 400 },
          );
        }
      }
      return unavailable();
    }
    if (request.method !== "GET") return unavailable();
    const action = url.searchParams.get("action");
    if (action === "evidence-init" || action === "evidence-inspect") {
      const evidence = new DurableEvidenceStore(this.ctx.storage);
      const input = {
        projectId: "project-one",
        sourceId: "note-one",
        sourceVersion: "1",
        idempotencyKey: "key-one",
        markdown: `${"a".repeat(1499)}😀end`,
        sourceDate: "2026-11-01",
      };
      let duplicateSame = null;
      let conflictKey = null;
      let conflictVersion = null;
      if (action === "evidence-init") {
        const first = evidence.register(input);
        const duplicate = evidence.register(input);
        const duplicateVersion = evidence.register({
          ...input,
          idempotencyKey: "key-two",
        });
        duplicateSame =
          first.documentRef === duplicate.documentRef &&
          first.documentRef === duplicateVersion.documentRef;
        try {
          evidence.register({ ...input, markdown: "Altered content" });
          conflictKey = false;
        } catch {
          conflictKey = true;
        }
        try {
          evidence.register({
            ...input,
            idempotencyKey: "key-three",
            markdown: "Altered content",
          });
          conflictVersion = false;
        } catch {
          conflictVersion = true;
        }
        evidence.ensureChunks(first);
        await this.ctx.storage.put("fixture-identity", {
          documentRef: first.documentRef,
          sourceId: first.sourceId,
          checksum: first.checksum,
        });
      }
      const records = evidence.list(input.projectId);
      const record = records[0] ?? null;
      const marker = await this.ctx.storage.get("fixture-identity");
      return Response.json({
        records,
        marker,
        duplicateSame,
        conflictKey,
        conflictVersion,
        chunks: evidence.chunks(input.projectId),
        other: record
          ? evidence.get("other-project", record.documentRef)
          : null,
        otherChunks: evidence.chunks("other-project"),
      });
    }
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS delivery_repositories(id TEXT PRIMARY KEY, identity TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_outbox(id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES delivery_repositories(id), operation_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, attempt_id TEXT, lease_expires_at TEXT);
      CREATE TABLE IF NOT EXISTS delivery_jobs(id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES delivery_repositories(id), kind TEXT NOT NULL, status TEXT NOT NULL, attempt_id TEXT, lease_expires_at TEXT);`);
    const store = new DeliveryStore(createDurableSqlDriver(this.ctx.storage));
    if (action === "init") {
      const repository = {
        provider: "github",
        repositoryId: "fixture",
        owner: "example",
        name: "test",
      };
      store.registerRepository(repository);
      store.transition("fixture", 0, "in_progress", {
        id: "one",
        operationKey: "one",
        kind: "fake",
      });
      let rolledBack = false;
      try {
        store.transition("fixture", 1, "ready", {
          id: "two",
          operationKey: "one",
          kind: "fake",
        });
      } catch {
        rolledBack = true;
      }
      store.claimOutbox(
        "one",
        "attempt-1",
        "2026-11-01T00:00:00.000Z",
        "2026-11-01T00:01:00.000Z",
      );
      return Response.json({
        rolledBack,
        repo: store.getRepository("fixture"),
        outbox: store.listOutbox("fixture"),
      });
    }
    if (action === "recover") {
      const recovered = store.recoverExpired("2026-11-01T00:02:00.000Z");
      let staleRejected = false;
      try {
        store.finishOutbox(
          "one",
          "attempt-1",
          "2026-11-01T00:02:00.000Z",
          "confirmed",
        );
      } catch {
        staleRejected = true;
      }
      return Response.json({
        recovered,
        staleRejected,
        outbox: store.listOutbox("fixture"),
      });
    }
    if (action === "inspect")
      return Response.json({
        repo: store.getRepository("fixture"),
        outbox: store.listOutbox("fixture"),
      });
    return unavailable();
  }
}

export default {
  async fetch(request, env) {
    if (!enabled(env)) return unavailable();
    const action = new URL(request.url).searchParams.get("action");
    if (
      ["migration-init", "migration-resume", "migration-inspect"].includes(
        action,
      )
    ) {
      if (request.method !== "GET") return unavailable();
      const object = (name) =>
        env.PROBE.get(env.PROBE.idFromName(`migration-${name}`));
      const sourceEvidence = object("source-evidence");
      const sourceManager = object("source-manager");
      const targetManager = object("target-manager");
      const readSource = async (mode) => {
        const response = await sourceEvidence.fetch(
          new Request(`https://fixture.invalid/hosted-fixture?mode=${mode}`),
        );
        if (!response.ok) throw new Error("Synthetic source unavailable");
        return response.json();
      };
      const record = await readSource(
        action === "migration-init" ? "evidence-init" : "evidence-info",
      );
      if (!record) throw new Error("Synthetic source missing");
      if (action === "migration-init") {
        const seeded = await sourceManager.fetch(
          new Request(
            "https://fixture.invalid/hosted-fixture?mode=manager-init",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(record),
            },
          ),
        );
        if (!seeded.ok) return seeded;
      }
      const snapshot = async (which, kind) => {
        const response = await which.fetch(
          new Request(
            `https://fixture.invalid/snapshot?kind=${kind}&mode=capture`,
          ),
        );
        if (!response.ok) throw new Error("Synthetic snapshot unavailable");
        return response.json();
      };
      const pair = {
        manager: await snapshot(sourceManager, "manager"),
        evidence: await snapshot(sourceEvidence, "evidence"),
      };
      const serviceHeaders = {
        authorization: `Bearer ${env.MANAGER_SERVICE_TOKEN}`,
        "x-manager-actor": env.MANAGER_OWNER_ID,
      };
      const importRequest = (token, loseAck = false) =>
        new Request(
          `https://fixture.invalid/stage2-manager/migration/import${loseAck ? "?loseAck=1" : ""}`,
          {
            method: "POST",
            headers: {
              ...serviceHeaders,
              "x-migration-token": token,
              "content-type": "application/json",
            },
            body: JSON.stringify(pair),
          },
        );
      const list = () =>
        targetManager.fetch(
          new Request(
            "https://fixture.invalid/stage2-manager/trpc/projects.list",
            { headers: serviceHeaders },
          ),
        );
      const before = await list();
      let wrong = null;
      let imported = null;
      if (action === "migration-init") {
        wrong = (await targetManager.fetch(importRequest("wrong"))).status;
        imported = (
          await targetManager.fetch(importRequest(migrationToken, true))
        ).status;
      } else if (action === "migration-resume")
        imported = (await targetManager.fetch(importRequest(migrationToken)))
          .status;
      const after = await list();
      const input = encodeURIComponent(
        JSON.stringify({
          projectId: record.projectId,
          documentRef: record.documentRef,
        }),
      );
      const read = await targetManager.fetch(
        new Request(
          `https://fixture.invalid/stage2-manager/trpc/evidence.read?input=${input}`,
          { headers: serviceHeaders },
        ),
      );
      return Response.json({
        before: before.status,
        wrong,
        imported,
        after: after.status,
        read: read.status,
        body: read.ok ? await read.json() : null,
        documentRef: record.documentRef,
        checksum: record.checksum,
      });
    }
    if (
      action === "hosted-evidence-init" ||
      action === "hosted-evidence-inspect"
    ) {
      if (request.method !== "GET") return unavailable();
      const evidence = env.PROBE.get(
        env.PROBE.idFromName("hosted-evidence-owner"),
      );
      const manager = env.PROBE.get(
        env.PROBE.idFromName("hosted-manager-owner"),
      );
      const mode =
        action === "hosted-evidence-init" ? "evidence-init" : "evidence-info";
      const evidenceResponse = await evidence.fetch(
        new Request(`https://fixture.invalid/hosted-fixture?mode=${mode}`),
      );
      if (!evidenceResponse.ok) return evidenceResponse;
      const record = await evidenceResponse.json();
      if (!record)
        return Response.json({ error: "No fixture evidence" }, { status: 500 });
      if (action === "hosted-evidence-init") {
        const seeded = await manager.fetch(
          new Request(
            "https://fixture.invalid/hosted-fixture?mode=manager-init",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(record),
            },
          ),
        );
        if (!seeded.ok) return seeded;
      }
      const serviceHeaders = {
        authorization: `Bearer ${env.MANAGER_SERVICE_TOKEN}`,
        "x-manager-actor": env.MANAGER_OWNER_ID,
      };
      const query = (projectId) =>
        `https://fixture.invalid/hosted-manager/trpc/evidence.read?input=${encodeURIComponent(JSON.stringify({ projectId, documentRef: record.documentRef }))}`;
      const unauthorized = await manager.fetch(
        new Request(query("00000000-0000-4000-8000-000000000001")),
      );
      const other = await manager.fetch(
        new Request(query("00000000-0000-4000-8000-000000000002"), {
          headers: serviceHeaders,
        }),
      );
      const success = await manager.fetch(
        new Request(query("00000000-0000-4000-8000-000000000001"), {
          headers: serviceHeaders,
        }),
      );
      return Response.json({
        unauthorized: unauthorized.status,
        other: other.status,
        success: success.status,
        body: await success.json(),
        sourceId: record.sourceId,
        documentRef: record.documentRef,
        checksum: record.checksum,
      });
    }
    if (action === "snapshot-init" || action === "snapshot-inspect") {
      if (request.method !== "GET") return unavailable();
      const results = {};
      for (const kind of ["manager", "evidence"]) {
        const endpoint = (mode) =>
          `https://fixture.invalid/snapshot?kind=${kind}&mode=${mode}`;
        const object = (side) =>
          env.PROBE.get(env.PROBE.idFromName(`snapshot-${kind}-${side}`));
        const fetchObject = (side, mode, snapshot) =>
          object(side).fetch(
            new Request(
              endpoint(mode),
              snapshot
                ? {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(snapshot),
                  }
                : undefined,
            ),
          );
        if (action === "snapshot-init") {
          const response = await fetchObject("source", "init");
          if (!response.ok) return response;
          const snapshot = await response.json();
          const before = await (await fetchObject("target", "capture")).json();
          const failed = await fetchObject("target", "restore", {
            ...snapshot,
            sha256: "invalid",
          });
          const afterFailed = await (
            await fetchObject("target", "capture")
          ).json();
          const restored = await fetchObject("target", "restore", snapshot);
          results[kind] = {
            source: snapshot.sha256,
            before: before.sha256,
            afterFailed: afterFailed.sha256,
            failed: failed.status,
            restored: restored.status,
          };
        } else {
          const source = await (await fetchObject("source", "capture")).json();
          const target = await (await fetchObject("target", "capture")).json();
          results[kind] = { source: source.sha256, target: target.sha256 };
        }
      }
      return Response.json(results);
    }
    if (
      ["binding-create", "binding-read", "binding-unauthorized"].includes(
        action,
      )
    ) {
      if (request.method !== "GET") return unavailable();
      const create = action === "binding-create";
      const headers = {
        authorization: `Bearer ${env.MANAGER_SERVICE_TOKEN}`,
        "x-manager-actor":
          action === "binding-unauthorized" ? "999999" : env.MANAGER_OWNER_ID,
        "content-type": "application/json",
      };
      return dispatchManagerRequest({
        binding: env.PROBE,
        target: new URL(
          create
            ? "https://unused.invalid/projects.create"
            : "https://unused.invalid/trpc/projects.list",
        ),
        method: create ? "POST" : "GET",
        headers,
        body: create
          ? new TextEncoder().encode(
              JSON.stringify({ name: "Synthetic binding project" }),
            ).buffer
          : undefined,
        allowNetworkFallback: false,
      });
    }
    const isService = new URL(request.url).pathname.startsWith("/trpc/");
    if (!isService && request.method !== "GET") return unavailable();
    const objectName = isService
      ? "private-service-fixture"
      : action?.startsWith("evidence-")
        ? "evidence-fixture"
        : "delivery-fixture";
    return env.PROBE.get(env.PROBE.idFromName(objectName)).fetch(request);
  },
};
