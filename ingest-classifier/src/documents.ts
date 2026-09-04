import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { AuditStore } from "./audit.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import { parseMarkdownFile } from "./markdown.ts";

export type EmbeddingStatus = "ready" | "missing";

export type StoredDocument = {
  id: number;
  auditId: number;
  sourcePath: string;
  destinationPath: string;
  categoryId: string;
  summary: string;
  cleanText: string;
  embedding: number[] | null;
  embeddingProvider: string | null;
  embeddingStatus: EmbeddingStatus;
  embeddingError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreDocumentInput = {
  auditId: number;
  sourcePath: string;
  destinationPath: string;
  categoryId: string;
  summary: string;
  cleanText: string;
  embedding: number[] | null;
  embeddingProvider: string | null;
  embeddingError?: string | null;
};

export class DocumentStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(path.resolve(databasePath));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  upsert(input: StoreDocumentInput): StoredDocument {
    const status: EmbeddingStatus = input.embedding ? "ready" : "missing";
    this.db
      .prepare(
        `INSERT INTO documents
          (audit_id, source_path, destination_path, category_id, summary, clean_text,
           embedding_json, embedding_provider, embedding_status, embedding_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(audit_id) DO UPDATE SET
           source_path = excluded.source_path,
           destination_path = excluded.destination_path,
           category_id = excluded.category_id,
           summary = excluded.summary,
           clean_text = excluded.clean_text,
           embedding_json = excluded.embedding_json,
           embedding_provider = excluded.embedding_provider,
           embedding_status = excluded.embedding_status,
           embedding_error = excluded.embedding_error,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        input.auditId,
        input.sourcePath,
        input.destinationPath,
        input.categoryId,
        input.summary,
        input.cleanText,
        input.embedding ? JSON.stringify(input.embedding) : null,
        input.embeddingProvider,
        status,
        input.embeddingError ?? null,
      );
    return this.getByAuditId(input.auditId)!;
  }

  setEmbedding(
    auditId: number,
    embedding: number[],
    provider: string,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE documents
         SET embedding_json = ?, embedding_provider = ?, embedding_status = 'ready',
             embedding_error = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE audit_id = ?`,
      )
      .run(JSON.stringify(embedding), provider, auditId);
    if (result.changes !== 1) throw new Error(`document for audit ${auditId} not found`);
  }

  deleteByAuditId(auditId: number): void {
    this.db.prepare("DELETE FROM documents WHERE audit_id = ?").run(auditId);
  }

  getByAuditId(auditId: number): StoredDocument | null {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE audit_id = ?")
      .get(auditId) as DocumentRow | undefined;
    return row ? mapRow(row) : null;
  }

  list(status?: EmbeddingStatus): StoredDocument[] {
    const rows = status
      ? (this.db
          .prepare("SELECT * FROM documents WHERE embedding_status = ? ORDER BY id")
          .all(status) as DocumentRow[])
      : (this.db.prepare("SELECT * FROM documents ORDER BY id").all() as DocumentRow[]);
    return rows.map(mapRow);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY,
        audit_id INTEGER NOT NULL UNIQUE,
        source_path TEXT NOT NULL,
        destination_path TEXT NOT NULL UNIQUE,
        category_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        clean_text TEXT NOT NULL,
        embedding_json TEXT,
        embedding_provider TEXT,
        embedding_status TEXT NOT NULL CHECK(embedding_status IN ('ready', 'missing')),
        embedding_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS documents_category ON documents(category_id);
      CREATE INDEX IF NOT EXISTS documents_embedding_status ON documents(embedding_status);
    `);
  }
}

export type BackfillReport = {
  examined: number;
  created: number;
  repaired: number;
  failed: number;
};

export async function backfillDocumentEmbeddings(options: {
  audit: AuditStore;
  documents: DocumentStore;
  embeddingProvider: EmbeddingProvider;
}): Promise<BackfillReport> {
  const report: BackfillReport = { examined: 0, created: 0, repaired: 0, failed: 0 };
  for (const record of options.audit.list("ok")) {
    report.examined += 1;
    const existing = options.documents.getByAuditId(record.id);
    if (existing?.embeddingStatus === "ready") continue;
    if (!record.destinationPath || !record.category || !record.summary) {
      report.failed += 1;
      continue;
    }
    try {
      const parsed = await parseMarkdownFile(record.destinationPath);
      const embedding = await options.embeddingProvider.embed(parsed.cleanText);
      options.documents.upsert({
        auditId: record.id,
        sourcePath: record.sourcePath,
        destinationPath: record.destinationPath,
        categoryId: record.category,
        summary: record.summary,
        cleanText: parsed.cleanText,
        embedding,
        embeddingProvider: options.embeddingProvider.id,
      });
      if (existing) report.repaired += 1;
      else report.created += 1;
    } catch (error) {
      report.failed += 1;
      if (existing) {
        options.documents.upsert({
          ...existing,
          embedding: null,
          embeddingProvider: null,
          embeddingError: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return report;
}

type DocumentRow = {
  id: number;
  audit_id: number;
  source_path: string;
  destination_path: string;
  category_id: string;
  summary: string;
  clean_text: string;
  embedding_json: string | null;
  embedding_provider: string | null;
  embedding_status: EmbeddingStatus;
  embedding_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    auditId: row.audit_id,
    sourcePath: row.source_path,
    destinationPath: row.destination_path,
    categoryId: row.category_id,
    summary: row.summary,
    cleanText: row.clean_text,
    embedding: row.embedding_json ? (JSON.parse(row.embedding_json) as number[]) : null,
    embeddingProvider: row.embedding_provider,
    embeddingStatus: row.embedding_status,
    embeddingError: row.embedding_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
