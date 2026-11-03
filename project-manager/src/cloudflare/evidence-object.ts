/** Private evidence owner. Only immutable reads are enabled in Stage 2. */
import { DurableEvidenceStore } from "../../../ingest-classifier/src/evidence/durable-store.ts";
import { evidenceReadInputSchema } from "../../../ingest-classifier/src/evidence/contracts.ts";
import { parseHostedConfig, verifyServiceRequest } from "../server/auth.ts";
import {
  createDurableSqlDriver,
  type DurableSqlStorage,
} from "../storage/sql-driver.ts";
import {
  captureSnapshot,
  restoreSnapshot,
  type Snapshot,
} from "../storage/snapshot.ts";
import { verifyMigrationToken } from "./migration-auth.ts";

type Environment = {
  MANAGER_SERVICE_TOKEN?: string;
  MANAGER_OWNER_ID?: string;
  MANAGER_MIGRATION_TOKEN?: string;
};
const headers = { "Cache-Control": "private, no-store" };
export class DurableEvidenceObject {
  private readonly service: NonNullable<ReturnType<typeof parseHostedConfig>>;
  private evidence?: DurableEvidenceStore;
  private readonly storage: DurableSqlStorage;
  private readonly migrationToken?: string;
  constructor(state: { storage: DurableSqlStorage }, env: Environment) {
    const service = parseHostedConfig({ MANAGER_HOSTED: "true", ...env });
    if (!service)
      throw new Error(
        "Hosted evidence service authentication is not configured.",
      );
    this.service = service;
    this.storage = state.storage;
    this.migrationToken = env.MANAGER_MIGRATION_TOKEN;
  }
  private snapshotDriver() {
    const driver = createDurableSqlDriver(this.storage);
    const applicationTables = driver
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) != 'sqlite_' AND name NOT IN ('__cf_kv', '_cf_KV', '_cf_METADATA', '__miniflare_do_name')",
      )
      .all();
    if (applicationTables.length === 0)
      this.evidence ??= new DurableEvidenceStore(this.storage);
    return driver;
  }
  async fetch(request: Request): Promise<Response> {
    if (
      !verifyServiceRequest(
        {
          authorization: request.headers.get("authorization") ?? undefined,
          "x-manager-actor":
            request.headers.get("x-manager-actor") ?? undefined,
          origin: request.headers.get("origin") ?? undefined,
        },
        this.service,
      )
    )
      return new Response(null, { status: 401, headers });
    const pathname = new URL(request.url).pathname;
    if (pathname === "/backup/snapshot") {
      if (request.method !== "POST")
        return new Response(null, { status: 404, headers });
      try {
        return Response.json(
          captureSnapshot(this.snapshotDriver(), "evidence"),
          { headers },
        );
      } catch {
        return new Response(null, { status: 503, headers });
      }
    }
    if (pathname === "/migration/digest" || pathname === "/migration/restore") {
      if (
        request.method !== "POST" ||
        !verifyMigrationToken(
          request.headers.get("x-migration-token"),
          this.migrationToken,
          this.service.token,
        )
      )
        return new Response(null, { status: 404, headers });
      try {
        const driver = this.snapshotDriver();
        if (pathname === "/migration/digest") {
          const snapshot = captureSnapshot(driver, "evidence");
          return Response.json(
            {
              sha256: snapshot.sha256,
              empty: snapshot.tables.every((table) => table.rows.length === 0),
            },
            { headers },
          );
        }
        const length = request.headers.get("content-length");
        if (
          length &&
          (!/^\d+$/.test(length) || Number(length) > 8 * 1024 * 1024)
        )
          return new Response(null, { status: 413, headers });
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > 8 * 1024 * 1024)
          return new Response(null, { status: 413, headers });
        const snapshot: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          !snapshot ||
          typeof snapshot !== "object" ||
          !("kind" in snapshot) ||
          snapshot.kind !== "evidence"
        )
          return new Response(null, { status: 400, headers });
        restoreSnapshot(driver, snapshot as Snapshot);
        return Response.json({ ok: true }, { headers });
      } catch {
        return new Response(null, { status: 409, headers });
      }
    }
    if (request.method !== "POST" || pathname !== "/read")
      return new Response(null, { status: 404, headers });
    try {
      const length = request.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > 4096))
        return new Response(null, { status: 413, headers });
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 4096)
        return new Response(null, { status: 413, headers });
      const parsed = evidenceReadInputSchema.safeParse(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (!parsed.success) return new Response(null, { status: 400, headers });
      this.evidence ??= new DurableEvidenceStore(this.storage);
      const result = this.evidence.get(
        parsed.data.projectId,
        parsed.data.documentRef,
      );
      if (!result) return new Response(null, { status: 404, headers });
      const {
        projectId,
        documentRef,
        sourceId,
        sourceVersion,
        checksum,
        markdown,
        sourceDate,
      } = result;
      return Response.json(
        {
          projectId,
          documentRef,
          sourceId,
          sourceVersion,
          checksum,
          markdown,
          sourceDate,
        },
        { headers },
      );
    } catch {
      return new Response(null, { status: 400, headers });
    }
  }
}
