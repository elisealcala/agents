/** Persist immutable source snapshots and project associations before organizing (DEC-028). */
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { OperationFailure } from "../application/contracts.ts";
import type { EvidenceIngestInput, EvidenceSnapshot } from "./contracts.ts";

export type EvidenceRecord = EvidenceSnapshot & {
  auditId: number | null;
  error: string | null;
};

/** A chunk's offsets always identify a verbatim substring of its source snapshot. */
export type StoredEvidenceChunk = {
  record: EvidenceRecord;
  start: number;
  end: number;
  embedding: number[] | null;
  embeddingProvider: string | null;
};

/** Bound retrieval text while preserving paragraph boundaries whenever possible. */
export const MAXIMUM_EVIDENCE_CHUNK_LENGTH = 1_500;
const PARAGRAPH_DELIMITER_LENGTH = 2;

export class EvidenceStore {
  private readonly db: DatabaseSync;

  constructor(database: string) {
    this.db = new DatabaseSync(database);
    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS project_evidence (
          document_ref TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          source_version TEXT NOT NULL,
          checksum TEXT NOT NULL,
          markdown TEXT NOT NULL,
          source_date TEXT,
          audit_id INTEGER,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(project_id, source_id, source_version)
        );
        CREATE TABLE IF NOT EXISTS project_evidence_keys (
          idempotency_key TEXT PRIMARY KEY,
          document_ref TEXT NOT NULL REFERENCES project_evidence(document_ref)
        );
        CREATE INDEX IF NOT EXISTS project_evidence_project
          ON project_evidence(project_id);
        CREATE TABLE IF NOT EXISTS project_evidence_chunks (
          document_ref TEXT NOT NULL REFERENCES project_evidence(document_ref),
          start_offset INTEGER NOT NULL,
          end_offset INTEGER NOT NULL,
          embedding_json TEXT,
          embedding_provider TEXT,
          PRIMARY KEY(document_ref, start_offset)
        );
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  /** Atomic identity binding: neither a source version nor a retry key can change bytes. */
  register(input: EvidenceIngestInput): EvidenceRecord {
    const checksum = hashMarkdown(input.markdown);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const keyed = this.db
        .prepare(`SELECT e.* FROM project_evidence e
          JOIN project_evidence_keys k ON e.document_ref = k.document_ref
          WHERE k.idempotency_key = ?`)
        .get(input.idempotencyKey) as EvidenceRow | undefined;
      if (keyed) this.assertSame(keyed, input, checksum);
      const version = this.db
        .prepare(`SELECT * FROM project_evidence
          WHERE project_id = ? AND source_id = ? AND source_version = ?`)
        .get(input.projectId, input.sourceId, input.sourceVersion) as
        | EvidenceRow
        | undefined;
      if (version) this.assertSame(version, input, checksum);
      const documentRef =
        keyed?.document_ref ??
        version?.document_ref ??
        `evidence-${randomUUID()}`;
      if (!keyed && !version) {
        this.db
          .prepare(`INSERT INTO project_evidence
          (document_ref, project_id, source_id, source_version, checksum, markdown, source_date)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(
            documentRef,
            input.projectId,
            input.sourceId,
            input.sourceVersion,
            checksum,
            input.markdown,
            input.sourceDate ?? null,
          );
      }
      this.db
        .prepare(`INSERT OR IGNORE INTO project_evidence_keys
        (idempotency_key, document_ref) VALUES (?, ?)`)
        .run(input.idempotencyKey, documentRef);
      this.db.exec("COMMIT");
      return this.get(input.projectId, documentRef)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** The project predicate is part of SQL, before records reach any ranking code. */
  list(projectId: string): EvidenceRecord[] {
    return (
      this.db
        .prepare(`SELECT * FROM project_evidence
      WHERE project_id = ? ORDER BY created_at, document_ref`)
        .all(projectId) as EvidenceRow[]
    ).map(mapRow);
  }

  get(projectId: string, documentRef: string): EvidenceRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM project_evidence
      WHERE project_id = ? AND document_ref = ?`)
      .get(projectId, documentRef) as EvidenceRow | undefined;
    return row ? mapRow(row) : null;
  }

  /** Only mutable processing metadata is updated; source fields are never overwritten. */
  link(documentRef: string, auditId: number): void {
    this.db
      .prepare(`UPDATE project_evidence SET audit_id = ?, error = NULL
      WHERE document_ref = ?`)
      .run(auditId, documentRef);
  }

  recordError(documentRef: string, error: string | null): void {
    this.db
      .prepare("UPDATE project_evidence SET error = ? WHERE document_ref = ?")
      .run(error, documentRef);
  }

  /** Deterministic boundaries make repair idempotent; source content stays immutable. */
  ensureChunks(record: EvidenceRecord): void {
    let start = 0;
    while (start < record.markdown.length) {
      let end = Math.min(
        start + MAXIMUM_EVIDENCE_CHUNK_LENGTH,
        record.markdown.length,
      );
      if (end < record.markdown.length) {
        const boundary = record.markdown.lastIndexOf(
          "\n\n",
          end - PARAGRAPH_DELIMITER_LENGTH,
        );
        if (boundary > start) end = boundary + PARAGRAPH_DELIMITER_LENGTH;
        // String offsets use UTF-16, but a chunk must not divide a surrogate pair.
        if (
          /^[\uDC00-\uDFFF]$/.test(record.markdown.charAt(end)) &&
          /^[\uD800-\uDBFF]$/.test(record.markdown.charAt(end - 1))
        )
          end -= 1;
      }
      this.db
        .prepare(`INSERT OR IGNORE INTO project_evidence_chunks
        (document_ref, start_offset, end_offset) VALUES (?, ?, ?)`)
        .run(record.documentRef, start, end);
      start = end;
    }
  }

  /** Join the project predicate before a single vector reaches ranking. */
  chunks(projectId: string, documentRef?: string): StoredEvidenceChunk[] {
    const restriction =
      documentRef === undefined ? "" : " AND e.document_ref = ?";
    const query = this.db.prepare(`SELECT e.*, c.start_offset, c.end_offset,
      c.embedding_json, c.embedding_provider FROM project_evidence_chunks c
      JOIN project_evidence e ON e.document_ref = c.document_ref
      WHERE e.project_id = ?${restriction} ORDER BY e.document_ref, c.start_offset`);
    const rows = (
      documentRef === undefined
        ? query.all(projectId)
        : query.all(projectId, documentRef)
    ) as ChunkRow[];
    return rows.map((row) => ({
      record: mapRow(row),
      start: row.start_offset,
      end: row.end_offset,
      embedding: row.embedding_json
        ? (JSON.parse(row.embedding_json) as number[])
        : null,
      embeddingProvider: row.embedding_provider,
    }));
  }

  setChunkEmbedding(
    documentRef: string,
    start: number,
    embedding: number[],
    provider: string,
  ): void {
    this.db
      .prepare(`UPDATE project_evidence_chunks
      SET embedding_json = ?, embedding_provider = ?
      WHERE document_ref = ? AND start_offset = ?`)
      .run(JSON.stringify(embedding), provider, documentRef, start);
  }

  private assertSame(
    row: EvidenceRow,
    input: EvidenceIngestInput,
    checksum: string,
  ): void {
    if (
      row.project_id !== input.projectId ||
      row.source_id !== input.sourceId ||
      row.source_version !== input.sourceVersion ||
      row.checksum !== checksum ||
      row.source_date !== (input.sourceDate ?? null)
    ) {
      throw new OperationFailure(
        "INVALID_INPUT",
        "Idempotency key or source version is already bound to different evidence.",
      );
    }
  }
}

/** Hash the original UTF-8 content; neither Markdown cleanup nor taxonomy edits affect it. */
export function hashMarkdown(markdown: string): string {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

type EvidenceRow = {
  document_ref: string;
  project_id: string;
  source_id: string;
  source_version: string;
  checksum: string;
  markdown: string;
  source_date: string | null;
  audit_id: number | null;
  error: string | null;
};

type ChunkRow = EvidenceRow & {
  start_offset: number;
  end_offset: number;
  embedding_json: string | null;
  embedding_provider: string | null;
};

function mapRow(row: EvidenceRow): EvidenceRecord {
  return {
    documentRef: row.document_ref,
    projectId: row.project_id,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    checksum: row.checksum,
    markdown: row.markdown,
    sourceDate: row.source_date,
    auditId: row.audit_id,
    error: row.error,
  };
}
