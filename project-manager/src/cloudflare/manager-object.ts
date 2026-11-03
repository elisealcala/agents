/** Private Durable Object owner for manager state. Model and intake remain disabled. */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { randomUUID } from "node:crypto";
import {
  BACKUP_RETRY_MS,
  MAXIMUM_BACKUP_BYTES,
  runScheduledBackup,
  type BackupStatus,
} from "./backup-scheduler.ts";
import { evidenceSnapshotSchema } from "../../../ingest-classifier/src/evidence/contracts.ts";
import type { Model, Worker } from "../application/contracts.ts";
import { Manager } from "../application/manager.ts";
import { DurableManagerStore } from "../storage/durable-manager-store.ts";
import { DeliveryStore } from "../storage/delivery-store.ts";
import {
  createDurableSqlDriver,
  type DurableSqlStorage,
} from "../storage/sql-driver.ts";
import {
  captureSnapshot,
  restoreSnapshot,
  validateSnapshotPair,
  type Snapshot,
} from "../storage/snapshot.ts";
import {
  assertMigrationQuiescent,
  migrateSnapshotPair,
  type MigrationMarker,
} from "./migration.ts";
import { validMigrationToken, verifyMigrationToken } from "./migration-auth.ts";
import { parseHostedConfig, verifyServiceRequest } from "../server/auth.ts";
import { appRouter } from "../server/router.ts";
import { DeliveryScheduler, type Adapters } from "../delivery/scheduler.ts";
import {
  DELIVERY_BATCH_SIZE,
  DELIVERY_INTERVAL_MS,
  DELIVERY_LEASE_MS,
  nextWakeup,
} from "./delivery-alarm.ts";

const unavailable = async (): Promise<never> => {
  throw new Error("The provider is not configured.");
};
const model: Model = {
  name: "unconfigured",
  extract: unavailable,
  answer: unavailable,
};
type Environment = {
  MANAGER_SERVICE_TOKEN?: string;
  MANAGER_OWNER_ID?: string;
  MANAGER_MIGRATION_TOKEN?: string;
  MANAGER_IMPORT_MODE?: string;
  BACKUP_ENABLED?: string;
  BACKUPS?: {
    put(key: string, body: string): Promise<unknown>;
    get(key: string): Promise<{ text(): Promise<string> } | null>;
  };
  EVIDENCE?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};
type ManagerState = {
  storage: DurableSqlStorage & {
    get?<T>(key: string): Promise<T | undefined>;
    put?(key: string, value: unknown): Promise<void>;
    getAlarm?(): Promise<number | null>;
    setAlarm?(at: number): Promise<void>;
  };
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
};
const markerKey = "stage2-migration";
const backupStatusKey = "stage2-backup-status";
const lastBackupKey = "stage2-last-good-backup";
const backupDueKey = "stage2-backup-due";
function completeMarker(marker: MigrationMarker | undefined): boolean {
  return (
    marker?.version === 1 &&
    marker.phase === "complete" &&
    /^[a-f0-9]{64}$/.test(marker.manager) &&
    /^[a-f0-9]{64}$/.test(marker.evidence)
  );
}
export class DurableManagerObject {
  private manager?: Manager;
  private readonly createManager: () => Manager;
  private readonly state: ManagerState;
  private readonly environment: Environment;
  private readonly service: NonNullable<ReturnType<typeof parseHostedConfig>>;
  private readonly capabilities: {
    evidence: "configured" | "unconfigured";
    model: "unconfigured";
    intake: "unconfigured";
    conversation: "unconfigured";
  };
  /** Only explicitly supplied adapters can execute; production registers none. */
  protected deliveryAdapters(): Adapters {
    return {};
  }
  constructor(state: ManagerState, env: Environment) {
    this.state = state;
    this.environment = env;
    const service = parseHostedConfig({
      MANAGER_HOSTED: "true",
      MANAGER_SERVICE_TOKEN: env.MANAGER_SERVICE_TOKEN,
      MANAGER_OWNER_ID: env.MANAGER_OWNER_ID,
    });
    if (!service)
      throw new Error(
        "Hosted manager service authentication is not configured.",
      );
    this.service = service;
    this.capabilities = {
      evidence: env.EVIDENCE ? "configured" : "unconfigured",
      model: "unconfigured",
      intake: "unconfigured",
      conversation: "unconfigured",
    };
    const binding = env.EVIDENCE;
    const worker: Worker = {
      identity: binding
        ? async () => ({ root: "durable-evidence" })
        : unavailable,
      ingest: unavailable,
      search: unavailable,
      read: binding
        ? async (projectId, documentRef) => {
            const response = await binding
              .get(binding.idFromName("primary"))
              .fetch(
                new Request("https://evidence.internal/read", {
                  method: "POST",
                  headers: {
                    authorization: `Bearer ${service.token}`,
                    "x-manager-actor": service.ownerId,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({ projectId, documentRef }),
                }),
              );
            if (!response.ok) throw new Error("Evidence is unavailable.");
            return evidenceSnapshotSchema.parse(await response.json());
          }
        : unavailable,
    };
    this.createManager = () =>
      new Manager(new DurableManagerStore(state.storage), worker, model, {
        canIntake: false,
        canAnswer: false,
      });
  }
  async fetch(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? undefined;
    const actor = request.headers.get("x-manager-actor") ?? undefined;
    const origin = request.headers.get("origin") ?? undefined;
    if (
      !verifyServiceRequest(
        { authorization, "x-manager-actor": actor, origin },
        this.service,
      )
    )
      return new Response(null, {
        status: 401,
        headers: { "Cache-Control": "private, no-store" },
      });
    const path = new URL(request.url).pathname;
    if (path === "/migration/import") return this.importPair(request);
    if (path === "/backup/status" && request.method === "GET")
      return this.backupStatus();
    if (path === "/backup/latest" && request.method === "GET")
      return this.latestBackup();
    if (
      this.environment.MANAGER_IMPORT_MODE !== undefined &&
      this.environment.MANAGER_IMPORT_MODE !== "required"
    )
      return new Response(null, {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    const get = this.state.storage.get?.bind(this.state.storage);
    if (!get && this.environment.MANAGER_IMPORT_MODE === "required")
      return new Response(null, {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    const marker = get ? await get<MigrationMarker>(markerKey) : undefined;
    const complete = completeMarker(marker);
    if (
      (marker && !complete) ||
      (this.environment.MANAGER_IMPORT_MODE === "required" && !complete)
    )
      return new Response(null, {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    try {
      this.manager ??= this.createManager();
      await this.ensureBackupSchedule();
      const manager = this.manager;
      const result = await fetchRequestHandler({
        endpoint: "/trpc",
        req: request,
        router: appRouter,
        createContext: () => ({
          manager,
          model: "unconfigured",
          capabilities: this.capabilities,
        }),
      });
      const headers = new Headers(result.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(result.body, { status: result.status, headers });
    } catch {
      return Response.json(
        { error: "Manager service unavailable." },
        { status: 500, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }
  private async importPair(request: Request): Promise<Response> {
    const unavailableResponse = () =>
      new Response(null, {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
      });
    const env = this.environment;
    const storage = this.state.storage;
    if (
      request.method !== "POST" ||
      env.MANAGER_IMPORT_MODE !== "required" ||
      !env.EVIDENCE ||
      !storage.get ||
      !storage.put ||
      !this.state.blockConcurrencyWhile ||
      !verifyMigrationToken(
        request.headers.get("x-migration-token"),
        env.MANAGER_MIGRATION_TOKEN,
        this.service.token,
      ) ||
      !validMigrationToken(env.MANAGER_MIGRATION_TOKEN, this.service.token)
    )
      return unavailableResponse();
    const contentLength = request.headers.get("content-length");
    if (
      contentLength &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > 8 * 1024 * 1024)
    )
      return new Response(null, { status: 413 });
    try {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 8 * 1024 * 1024)
        return new Response(null, { status: 413 });
      const pair = JSON.parse(new TextDecoder().decode(bytes)) as {
        manager: Snapshot;
        evidence: Snapshot;
      };
      const managerDriver = createDurableSqlDriver(storage);
      const evidence = env.EVIDENCE;
      const migrationToken = env.MANAGER_MIGRATION_TOKEN;
      const readManagerSnapshot = () => {
        const applicationTables = managerDriver
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) != 'sqlite_' AND name NOT IN ('__cf_kv', '_cf_KV', '_cf_METADATA', '__miniflare_do_name')",
          )
          .all();
        if (applicationTables.length === 0) new DurableManagerStore(storage);
        return captureSnapshot(managerDriver, "manager");
      };
      const callEvidence = async (
        path: string,
        snapshot?: Snapshot,
      ): Promise<Response> => {
        const response = await evidence
          .get(evidence.idFromName("primary"))
          .fetch(
            new Request(`https://evidence.internal/migration/${path}`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${this.service.token}`,
                "x-manager-actor": this.service.ownerId,
                "x-migration-token": migrationToken,
                "content-type": "application/json",
              },
              body: snapshot ? JSON.stringify(snapshot) : undefined,
            }),
          );
        if (!response.ok) throw new Error("Evidence migration failed");
        return response;
      };
      const getMarker = storage.get.bind(storage);
      const putMarker = storage.put.bind(storage);
      const block = this.state.blockConcurrencyWhile.bind(this.state);
      await migrateSnapshotPair(pair, {
        runExclusive: async <T>(operation: () => Promise<T>): Promise<T> => {
          let result: T | undefined;
          let failed = false;
          let cause: unknown;
          await block(async () => {
            try {
              result = await operation();
            } catch (error) {
              failed = true;
              cause = error;
            }
          });
          if (failed) throw cause;
          return result as T;
        },
        loadMarker: async () =>
          (await getMarker<MigrationMarker>(markerKey)) ?? null,
        saveMarker: (marker) => putMarker(markerKey, marker),
        preflightManager: async (snapshot) => {
          const current = readManagerSnapshot();
          if (
            current.sha256 !== snapshot.sha256 &&
            current.tables.some((table) => table.rows.length !== 0)
          )
            throw new Error("Manager destination is not empty");
        },
        preflightEvidence: async (snapshot) => {
          const data: unknown = await (await callEvidence("digest")).json();
          if (
            !data ||
            typeof data !== "object" ||
            !("sha256" in data) ||
            typeof data.sha256 !== "string" ||
            !("empty" in data) ||
            typeof data.empty !== "boolean"
          )
            throw new Error("Invalid evidence status");
          if (data.sha256 !== snapshot.sha256 && !data.empty)
            throw new Error("Evidence destination is not empty");
        },
        readEvidenceDigest: async () => {
          const data: unknown = await (await callEvidence("digest")).json();
          if (
            !data ||
            typeof data !== "object" ||
            !("sha256" in data) ||
            typeof data.sha256 !== "string"
          )
            throw new Error("Invalid evidence digest");
          return data.sha256;
        },
        restoreEvidence: async (snapshot) => {
          await callEvidence("restore", snapshot);
        },
        readManagerDigest: async () => readManagerSnapshot().sha256,
        restoreManager: async (snapshot) =>
          restoreSnapshot(managerDriver, snapshot),
      });
      await this.ensureBackupSchedule();
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch {
      return new Response(null, {
        status: 409,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
  }
  private backupConfigured(): boolean {
    const storage = this.state.storage;
    return (
      this.environment.BACKUP_ENABLED === "true" &&
      Boolean(
        this.environment.BACKUPS &&
          this.environment.EVIDENCE &&
          storage.get &&
          storage.put &&
          storage.getAlarm &&
          storage.setAlarm &&
          this.state.blockConcurrencyWhile,
      )
    );
  }
  private async backupStatus(): Promise<Response> {
    const storage = this.state.storage;
    const configured = this.backupConfigured();
    const latest = storage.get
      ? ((await storage.get<BackupStatus>(backupStatusKey)) ?? null)
      : null;
    const next =
      configured && storage.get
        ? ((await storage.get<number>(backupDueKey)) ??
          (storage.getAlarm ? await storage.getAlarm() : null))
        : null;
    const lastGood = storage.get
      ? await storage.get<unknown>(lastBackupKey)
      : undefined;
    let hasBackup = false;
    if (
      typeof lastGood === "string" &&
      this.environment.BACKUPS &&
      /^manager-backups\/\d{4}-\d{2}-\d{2}\/\d{1,16}-[a-zA-Z0-9-]{1,80}\.json$/.test(
        lastGood,
      )
    ) {
      try {
        hasBackup = (await this.environment.BACKUPS.get(lastGood)) !== null;
      } catch {
        /* show no download while storage is unavailable */
      }
    }
    return Response.json(
      { configured, latest, next, hasBackup },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  private async latestBackup(): Promise<Response> {
    const unavailable = () =>
      new Response(null, {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    const storage = this.state.storage;
    const bucket = this.environment.BACKUPS;
    if (!storage.get || !bucket) return unavailable();
    try {
      const key = await storage.get<unknown>(lastBackupKey);
      if (
        typeof key !== "string" ||
        !/^manager-backups\/\d{4}-\d{2}-\d{2}\/\d{1,16}-[a-zA-Z0-9-]{1,80}\.json$/.test(
          key,
        )
      )
        return unavailable();
      const object = await bucket.get(key);
      if (!object) return unavailable();
      const body = await object.text();
      if (Buffer.byteLength(body, "utf8") > MAXIMUM_BACKUP_BYTES)
        return unavailable();
      const pair: unknown = JSON.parse(body);
      if (
        !pair ||
        typeof pair !== "object" ||
        !("manager" in pair) ||
        !("evidence" in pair)
      )
        return unavailable();
      const { manager, evidence } = pair as {
        manager: Snapshot;
        evidence: Snapshot;
      };
      validateSnapshotPair(manager, evidence);
      assertMigrationQuiescent(manager);
      return new Response(body, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=manager-backup.json",
          "Cache-Control": "private, no-store",
        },
      });
    } catch {
      return unavailable();
    }
  }
  private async ensureBackupSchedule(): Promise<void> {
    const storage = this.state.storage;
    if (!storage.getAlarm || !storage.setAlarm || !storage.get || !storage.put)
      return;
    try {
      const existing = await storage.getAlarm();
      let backup = await storage.get<number>(backupDueKey);
      if (this.environment.BACKUP_ENABLED === "true" && backup === undefined) {
        backup = existing ?? Date.now() + 1000;
        await storage.put(backupDueKey, backup);
      }
      const due = nextWakeup(
        Date.now() + DELIVERY_INTERVAL_MS,
        this.environment.BACKUP_ENABLED === "true" ? (backup ?? null) : null,
      );
      if (existing === null || existing > due) await storage.setAlarm(due);
    } catch {
      // Setup remains reachable; a later request can retry scheduling.
    }
  }
  async alarm(): Promise<void> {
    const env = this.environment;
    const storage = this.state.storage;
    if (!storage.setAlarm || !storage.get || !storage.put)
      throw new Error("Alarm storage unavailable");
    // Pre-arm before reading state or executing work, preserving crash recovery.
    await storage.setAlarm(Date.now() + DELIVERY_INTERVAL_MS);
    let backupDue =
      env.BACKUP_ENABLED === "true"
        ? ((await storage.get<number>(backupDueKey)) ?? Date.now())
        : null;
    await storage.setAlarm(
      nextWakeup(Date.now() + DELIVERY_INTERVAL_MS, backupDue),
    );
    if (
      env.BACKUP_ENABLED === "true" &&
      backupDue !== null &&
      backupDue <= Date.now()
    ) {
      // Persist the retry before backup I/O; delivery ticks must not postpone it.
      backupDue = Date.now() + BACKUP_RETRY_MS;
      await storage.put(backupDueKey, backupDue);
      await storage.setAlarm(
        nextWakeup(Date.now() + DELIVERY_INTERVAL_MS, backupDue),
      );
      try {
        if (
          !this.backupConfigured() ||
          !env.BACKUPS ||
          !env.EVIDENCE ||
          !storage.get ||
          !storage.put ||
          !this.state.blockConcurrencyWhile
        )
          throw new Error("Backup is not configured");
        const marker = await storage.get<MigrationMarker>(markerKey);
        if (
          (env.MANAGER_IMPORT_MODE !== undefined &&
            env.MANAGER_IMPORT_MODE !== "required") ||
          (marker && !completeMarker(marker)) ||
          (env.MANAGER_IMPORT_MODE === "required" && !completeMarker(marker))
        )
          throw new Error("Manager is locked");
        const bucket = env.BACKUPS;
        const evidence = env.EVIDENCE;
        const block = this.state.blockConcurrencyWhile.bind(this.state);
        await runScheduledBackup({
          now: () => Date.now(),
          schedule: async (at) => {
            backupDue = at;
            await storage.put!(backupDueKey, at);
            await storage.setAlarm!(
              nextWakeup(Date.now() + DELIVERY_INTERVAL_MS, at),
            );
          },
          capture: async () => {
            let pair: { manager: Snapshot; evidence: Snapshot } | undefined;
            let failed = false;
            let cause: unknown;
            await block(async () => {
              try {
                this.manager ??= this.createManager();
                const manager = captureSnapshot(
                  createDurableSqlDriver(storage),
                  "manager",
                );
                const response = await evidence
                  .get(evidence.idFromName("primary"))
                  .fetch(
                    new Request("https://evidence.internal/backup/snapshot", {
                      method: "POST",
                      headers: {
                        authorization: `Bearer ${this.service.token}`,
                        "x-manager-actor": this.service.ownerId,
                      },
                    }),
                  );
                if (!response.ok)
                  throw new Error("Evidence backup unavailable");
                pair = {
                  manager,
                  evidence: (await response.json()) as Snapshot,
                };
              } catch (error) {
                failed = true;
                cause = error;
              }
            });
            if (failed) throw cause;
            if (!pair) throw new Error("Backup capture unavailable");
            return pair;
          },
          put: async (key, body) => {
            await bucket.put(key, body);
          },
          get: async (key) => (await bucket.get(key))?.text() ?? null,
          record: async (status) => {
            if (status.state === "ok" && status.key)
              await storage.put!(lastBackupKey, status.key);
            await storage.put!(backupStatusKey, status);
          },
          id: () => randomUUID(),
        });
      } catch {
        // Do not rely on the platform's finite automatic retries: the next retry was
        // already armed above. Keep the reason generic and avoid private data in logs.
        try {
          await storage.put?.(backupStatusKey, {
            state: "error",
            at: new Date().toISOString(),
          });
        } catch {
          /* the retry stays armed */
        }
      }
    }
    // Never execute delivery against a partially imported pair.
    const marker = await storage.get<MigrationMarker>(markerKey);
    if (
      (env.MANAGER_IMPORT_MODE !== undefined &&
        env.MANAGER_IMPORT_MODE !== "required") ||
      (marker && !completeMarker(marker)) ||
      (env.MANAGER_IMPORT_MODE === "required" && !completeMarker(marker))
    )
      return;
    const delivery = new DeliveryStore(createDurableSqlDriver(storage));
    const scheduler = new DeliveryScheduler(delivery, this.deliveryAdapters(), {
      leaseMs: DELIVERY_LEASE_MS,
      maxAttempts: DELIVERY_BATCH_SIZE,
    });
    try {
      await scheduler.tick();
    } finally {
      await scheduler.stop();
    }
    await storage.setAlarm(
      nextWakeup(
        Date.now() + DELIVERY_INTERVAL_MS,
        env.BACKUP_ENABLED === "true"
          ? ((await storage.get<number>(backupDueKey)) ?? null)
          : null,
      ),
    );
  }
}
