/**
 * The per-file audit trail: one row per inbox file, from detection to filing.
 *
 * This is the record of what the classifier did and why. Rows are never
 * deleted, so a failed or skipped file stays visible and re-runnable.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

type AuditableClassification = {
  category: string;
  summary: string;
  tags: string[];
  confidence_score: number;
};

/** Where a file ended up. Only `ok` means it moved out of the inbox. */
export type AuditStatus = "processing" | "ok" | "failed" | "skipped";

/** The step that produced an event, used to locate where a file broke. */
export type AuditStage = "detect" | "parse" | "classify" | "move";

/**
 * One file's audit row.
 *
 * The nullable fields are filled in as the pipeline progresses, so they are
 * all null while `status` is `processing`. Use {@link isCompletedAuditRecord}
 * to obtain a row that is proven to carry them.
 */
export type AuditRecord = {
  id: number;
  sourcePath: string;
  destinationPath: string | null;
  sourceSha256: string;
  category: string | null;
  summary: string | null;
  tags: string[];
  confidence: number | null;
  provider: string | null;
  model: string | null;
  status: AuditStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * An audit row proven to carry everything a filed note needs.
 *
 * `complete()` only flips a row to `ok` when destination, category, summary,
 * tags and confidence are all present, so in practice every `ok` row written
 * by this code satisfies this type. It is a narrowed subtype rather than a
 * separate union arm because databases written before that SQL guard existed
 * may still hold an `ok` row with gaps, and those rows must stay readable and
 * countable rather than disappear (DEC-022).
 */
export type CompletedAuditRecord = AuditRecord & {
  status: "ok";
  destinationPath: string;
  category: string;
  summary: string;
  confidence: number;
};

/**
 * Narrow a row to {@link CompletedAuditRecord}.
 *
 * Returns false for a legacy `ok` row with missing fields, which lets callers
 * count it as a failure instead of trusting it.
 */
export function isCompletedAuditRecord(
  record: AuditRecord,
): record is CompletedAuditRecord {
  return (
    record.status === "ok" &&
    record.destinationPath !== null &&
    record.category !== null &&
    record.summary !== null &&
    record.confidence !== null
  );
}

/** Identifies the file a row is opened for, and the model that will judge it. */
export type AuditBeginInput = {
  sourcePath: string;
  sourceSha256: string;
  provider: string;
  model: string;
};

/**
 * Everything known about a failure.
 *
 * `auditId` is absent when the file failed before a row was opened, in which
 * case one is created so no file fails invisibly.
 */
export type AuditFailureInput = {
  auditId?: number;
  sourcePath: string;
  sourceSha256?: string;
  provider?: string;
  model?: string;
  stage: AuditStage;
  error: string;
};

/** Owns the `audit_records` table and its per-stage event log. */
export class AuditStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.databasePath = path.resolve(databasePath);
    mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    try {
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Close the database handle. The store is unusable afterwards. */
  close(): void {
    this.db.close();
  }

  /**
   * Open a row for a file, or reuse the existing row for the same content.
   *
   * Returns null when this exact file has already been filed successfully.
   */
  begin(input: AuditBeginInput): number | null {
    const existing = this.db
      .prepare(
        `SELECT id, status FROM audit_records
         WHERE source_path = ? AND source_sha256 = ?`,
      )
      .get(input.sourcePath, input.sourceSha256) as
      | { id: number; status: AuditStatus }
      | undefined;
    if (existing?.status === "ok" || existing?.status === "processing") {
      return null;
    }
    if (existing) {
      this.db
        .prepare(
          `UPDATE audit_records
           SET status = 'processing', error = NULL, provider = ?, model = ?,
               destination_path = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(input.provider, input.model, existing.id);
      return existing.id;
    }
    const result = this.db
      .prepare(
        `INSERT INTO audit_records
          (source_path, source_sha256, provider, model, status)
         VALUES (?, ?, ?, ?, 'processing')`,
      )
      .run(input.sourcePath, input.sourceSha256, input.provider, input.model);
    return Number(result.lastInsertRowid);
  }

  recordEvent(
    auditId: number,
    stage: AuditStage,
    status: "ok" | "failed" | "skipped",
    details?: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_events (audit_id, stage, status, details)
         VALUES (?, ?, ?, ?)`,
      )
      .run(auditId, stage, status, details ?? null);
  }

  setClassification(auditId: number, result: AuditableClassification): void {
    this.db
      .prepare(
        `UPDATE audit_records
         SET category = ?, summary = ?, tags_json = ?, confidence = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(
        result.category,
        result.summary,
        JSON.stringify(result.tags),
        result.confidence_score,
        auditId,
      );
  }

  /** Record where the file landed, before the move is confirmed complete. */
  setDestination(auditId: number, destinationPath: string): void {
    this.db
      .prepare(
        `UPDATE audit_records
         SET destination_path = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(destinationPath, auditId);
  }

  /**
   * Mark a file successfully filed.
   *
   * The SQL guard is the invariant behind {@link CompletedAuditRecord}: a row
   * missing any required field will not flip, and this throws instead.
   */
  complete(auditId: number): void {
    const result = this.db
      .prepare(
        `UPDATE audit_records
         SET status = 'ok', error = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND destination_path IS NOT NULL AND category IS NOT NULL
           AND summary IS NOT NULL AND tags_json IS NOT NULL
           AND confidence IS NOT NULL`,
      )
      .run(auditId);
    if (result.changes !== 1) {
      throw new Error(
        `audit ${auditId} is incomplete and cannot be marked successful`,
      );
    }
  }

  /** Record a failure at one stage, creating the row if detection never did. */
  fail(input: AuditFailureInput): number {
    const sourceSha256 = input.sourceSha256 ?? "unavailable";
    let auditId = input.auditId;
    if (auditId === undefined) {
      const existing = this.db
        .prepare(
          `SELECT id FROM audit_records
           WHERE source_path = ? AND source_sha256 = ?`,
        )
        .get(input.sourcePath, sourceSha256) as { id: number } | undefined;
      auditId = existing?.id;
    }
    if (auditId === undefined) {
      auditId = Number(
        this.db
          .prepare(
            `INSERT INTO audit_records
              (source_path, source_sha256, provider, model, status, error)
             VALUES (?, ?, ?, ?, 'failed', ?)`,
          )
          .run(
            input.sourcePath,
            sourceSha256,
            input.provider ?? null,
            input.model ?? null,
            input.error,
          ).lastInsertRowid,
      );
    }
    this.db
      .prepare(
        `UPDATE audit_records
         SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(input.error, auditId);
    this.recordEvent(auditId, input.stage, "failed", input.error);
    return auditId;
  }

  skip(sourcePath: string, sourceFingerprint: string, reason: string): void {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO audit_records
          (source_path, source_sha256, status, error)
         VALUES (?, ?, 'skipped', ?)`,
      )
      .run(sourcePath, sourceFingerprint, reason);
    if (result.changes === 1) {
      this.recordEvent(
        Number(result.lastInsertRowid),
        "detect",
        "skipped",
        reason,
      );
    }
  }

  findByFilename(filename: string): AuditRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_records
         WHERE source_path LIKE ? OR destination_path LIKE ?
         ORDER BY id DESC`,
      )
      .all(`%${filename}`, `%${filename}`) as DatabaseRow[];
    return rows.map(mapRow);
  }

  /** Every row, newest first, optionally filtered to one status. */
  list(status?: AuditStatus): AuditRecord[] {
    const rows = status
      ? (this.db
          .prepare("SELECT * FROM audit_records WHERE status = ? ORDER BY id")
          .all(status) as DatabaseRow[])
      : (this.db
          .prepare("SELECT * FROM audit_records ORDER BY id")
          .all() as DatabaseRow[]);
    return rows.map(mapRow);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_records (
        id INTEGER PRIMARY KEY,
        source_path TEXT NOT NULL,
        destination_path TEXT,
        source_sha256 TEXT NOT NULL,
        category TEXT,
        summary TEXT,
        tags_json TEXT,
        confidence REAL,
        provider TEXT,
        model TEXT,
        status TEXT NOT NULL CHECK(status IN ('processing', 'ok', 'failed', 'skipped')),
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_path, source_sha256)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY,
        audit_id INTEGER NOT NULL REFERENCES audit_records(id),
        stage TEXT NOT NULL CHECK(stage IN ('detect', 'parse', 'classify', 'move')),
        status TEXT NOT NULL CHECK(status IN ('ok', 'failed', 'skipped')),
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS audit_records_filename
        ON audit_records(source_path, destination_path);
      CREATE INDEX IF NOT EXISTS audit_events_record
        ON audit_events(audit_id);
    `);
  }
}

type DatabaseRow = {
  id: number;
  source_path: string;
  destination_path: string | null;
  source_sha256: string;
  category: string | null;
  summary: string | null;
  tags_json: string | null;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  status: AuditStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: DatabaseRow): AuditRecord {
  return {
    id: row.id,
    sourcePath: row.source_path,
    destinationPath: row.destination_path,
    sourceSha256: row.source_sha256,
    category: row.category,
    summary: row.summary,
    tags: row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [],
    confidence: row.confidence,
    provider: row.provider,
    model: row.model,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
