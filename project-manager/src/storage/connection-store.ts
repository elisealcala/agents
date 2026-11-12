/** Durable GitHub connection state. Credentials are encrypted; the key is supplied by the caller. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  ConnectionError,
  connectionKinds,
  disabledCapabilities,
  normalizeCapabilities,
  type ConnectionCapabilities,
  type ConnectionKind,
  type ConnectionReceipt,
  type ConnectionStatus,
  type ConnectionView,
} from "../integrations/github/connections.ts";
import type { SqlDriver } from "./sql-driver.ts";

type Row = {
  id: string;
  kind: string;
  external_ref: string;
  status: string;
  capabilities: string;
  revision: number;
  credential: string | null;
};

export type CreateConnectionInput = {
  id: string;
  kind: ConnectionKind;
  externalRef: string;
  credential: string;
  capabilities?: Partial<ConnectionCapabilities>;
};

export class ConnectionStore {
  private readonly key: Buffer;

  constructor(
    private readonly db: SqlDriver,
    key: Uint8Array,
  ) {
    if (key.byteLength !== 32) throw new ConnectionError("Invalid key");
    this.key = Buffer.from(key);
    this.db.exec(`CREATE TABLE IF NOT EXISTS github_connections(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, external_ref TEXT NOT NULL,
      status TEXT NOT NULL, capabilities TEXT NOT NULL, revision INTEGER NOT NULL,
      credential TEXT);
      CREATE TABLE IF NOT EXISTS github_connection_receipts(
      seq INTEGER PRIMARY KEY AUTOINCREMENT, connection_id TEXT NOT NULL,
      action TEXT NOT NULL, revision INTEGER NOT NULL, at TEXT NOT NULL);`);
  }

  create(
    input: CreateConnectionInput,
    now: string = new Date().toISOString(),
  ): ConnectionView {
    if (
      !input.id?.trim() ||
      !input.externalRef?.trim() ||
      !input.credential ||
      !connectionKinds.includes(input.kind)
    )
      throw new ConnectionError("Invalid connection");
    const capabilities = normalizeCapabilities(input.capabilities);
    this.db.transaction(() => {
      if (this.find(input.id)) throw new ConnectionError("Connection exists");
      this.db
        .prepare(
          "INSERT INTO github_connections(id, kind, external_ref, status, capabilities, revision, credential) VALUES (?, ?, ?, 'connected', ?, 0, ?)",
        )
        .run(
          input.id,
          input.kind,
          input.externalRef,
          JSON.stringify(capabilities),
          this.seal(input.id, input.credential),
        );
      this.receipt(input.id, "created", 0, now);
    });
    return this.get(input.id);
  }

  get(id: string): ConnectionView {
    const row = this.find(id);
    if (!row) throw new ConnectionError("Unknown connection");
    return toView(row);
  }

  list(): ConnectionView[] {
    const rows = this.db
      .prepare("SELECT * FROM github_connections ORDER BY id")
      .all() as Row[];
    return rows.map(toView);
  }

  /** Returns the usable credential; revoked connections and wrong keys fail with a redacted error. */
  readCredential(id: string): string {
    const row = this.find(id);
    if (!row || row.status === "disconnected" || row.credential === null)
      throw new ConnectionError("Credential unavailable");
    return this.open(id, row.credential);
  }

  updateState(
    id: string,
    expectedRevision: number,
    status: Exclude<ConnectionStatus, "disconnected">,
    capabilities: Partial<ConnectionCapabilities>,
    now: string = new Date().toISOString(),
  ): ConnectionView {
    if (status !== "connected" && status !== "degraded")
      throw new ConnectionError("Invalid status");
    const next = normalizeCapabilities(capabilities);
    this.db.transaction(() => {
      const row = this.require(id, expectedRevision);
      if (row.status === "disconnected")
        throw new ConnectionError("Connection is disconnected");
      this.bump(id, expectedRevision, {
        status,
        capabilities: JSON.stringify(next),
      });
      this.receipt(id, "updated", expectedRevision + 1, now);
    });
    return this.get(id);
  }

  rotate(
    id: string,
    expectedRevision: number,
    credential: string,
    now: string = new Date().toISOString(),
  ): ConnectionView {
    if (!credential) throw new ConnectionError("Invalid credential");
    this.db.transaction(() => {
      const row = this.require(id, expectedRevision);
      if (row.status === "disconnected")
        throw new ConnectionError("Connection is disconnected");
      // The previous ciphertext is overwritten, so it is no longer usable.
      this.bump(id, expectedRevision, {
        credential: this.seal(id, credential),
      });
      this.receipt(id, "rotated", expectedRevision + 1, now);
    });
    return this.get(id);
  }

  disconnect(
    id: string,
    expectedRevision: number,
    now: string = new Date().toISOString(),
  ): ConnectionView {
    this.db.transaction(() => {
      this.require(id, expectedRevision);
      this.bump(id, expectedRevision, {
        status: "disconnected",
        capabilities: JSON.stringify(disabledCapabilities),
        credential: null,
      });
      this.receipt(id, "disconnected", expectedRevision + 1, now);
    });
    return this.get(id);
  }

  receipts(id: string): ConnectionReceipt[] {
    const rows = this.db
      .prepare(
        "SELECT seq, connection_id, action, revision, at FROM github_connection_receipts WHERE connection_id=? ORDER BY seq",
      )
      .all(id) as {
      seq: number;
      connection_id: string;
      action: ConnectionReceipt["action"];
      revision: number;
      at: string;
    }[];
    return rows.map((r) => ({
      seq: r.seq,
      connectionId: r.connection_id,
      action: r.action,
      revision: r.revision,
      at: r.at,
    }));
  }

  private find(id: string): Row | undefined {
    return this.db
      .prepare("SELECT * FROM github_connections WHERE id=?")
      .get(id) as Row | undefined;
  }
  private require(id: string, expectedRevision: number): Row {
    const row = this.find(id);
    if (!row) throw new ConnectionError("Unknown connection");
    if (
      !Number.isSafeInteger(expectedRevision) ||
      row.revision !== expectedRevision
    )
      throw new ConnectionError("Revision conflict");
    return row;
  }
  private bump(
    id: string,
    expectedRevision: number,
    fields: {
      status?: string;
      capabilities?: string;
      credential?: string | null;
    },
  ): void {
    const current = this.find(id);
    if (!current) throw new ConnectionError("Unknown connection");
    const changed = this.db
      .prepare(
        "UPDATE github_connections SET status=?, capabilities=?, credential=?, revision=revision+1 WHERE id=? AND revision=?",
      )
      .run(
        fields.status ?? current.status,
        fields.capabilities ?? current.capabilities,
        fields.credential === undefined
          ? current.credential
          : fields.credential,
        id,
        expectedRevision,
      );
    if (Number(changed.changes) !== 1)
      throw new ConnectionError("Revision conflict");
  }
  private receipt(
    id: string,
    action: ConnectionReceipt["action"],
    revision: number,
    at: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO github_connection_receipts(connection_id, action, revision, at) VALUES (?, ?, ?, ?)",
      )
      .run(id, action, revision, at);
  }
  /** The connection id is authenticated data, so blobs cannot be moved between records. */
  private seal(id: string, plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const body = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  private open(id: string, blob: string): string {
    try {
      const raw = Buffer.from(blob, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        raw.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([
        decipher.update(raw.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new ConnectionError("Credential unavailable");
    }
  }
}

function toView(row: Row): ConnectionView {
  return {
    id: row.id,
    kind: row.kind as ConnectionKind,
    externalRef: row.external_ref,
    status: row.status as ConnectionStatus,
    capabilities: normalizeCapabilities(JSON.parse(row.capabilities)),
    revision: row.revision,
    hasCredential: row.credential !== null,
  };
}
