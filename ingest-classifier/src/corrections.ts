import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const DEFAULT_CORRECTION_EXAMPLE_LIMIT = 5;

export type Correction = {
  id: number;
  originalPath: string;
  wrongCategory: string;
  correctCategory: string;
  note: string | null;
  createdAt: string;
};

export class CorrectionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    const absolutePath = path.resolve(databasePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    this.db = new DatabaseSync(absolutePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  record(input: {
    originalPath: string;
    wrongCategory: string;
    correctCategory: string;
    note?: string;
  }): Correction {
    if (!input.originalPath.trim()) throw new Error("correction path is required");
    if (!input.wrongCategory.trim()) throw new Error("wrong category is required");
    if (!input.correctCategory.trim()) throw new Error("correct category is required");
    const result = this.db
      .prepare(
        `INSERT INTO corrections
          (original_path, wrong_category, correct_category, note)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.originalPath.trim(),
        input.wrongCategory.trim(),
        input.correctCategory.trim(),
        input.note?.trim() || null,
      );
    return this.get(Number(result.lastInsertRowid))!;
  }

  get(id: number): Correction | null {
    const row = this.db
      .prepare("SELECT * FROM corrections WHERE id = ?")
      .get(id) as CorrectionRow | undefined;
    return row ? mapRow(row) : null;
  }

  listRecent(limit = DEFAULT_CORRECTION_EXAMPLE_LIMIT): Correction[] {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error("correction limit must be a non-negative integer");
    }
    return (this.db
      .prepare("SELECT * FROM corrections ORDER BY id DESC LIMIT ?")
      .all(limit) as CorrectionRow[]).map(mapRow);
  }

  toPromptExamples(limit = DEFAULT_CORRECTION_EXAMPLE_LIMIT): string[] {
    return this.listRecent(limit).map(
      (correction) =>
        `File ${correction.originalPath} was incorrectly classified as ${correction.wrongCategory}; use ${correction.correctCategory}.${correction.note ? ` Note: ${correction.note}` : ""}`,
    );
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS corrections (
        id INTEGER PRIMARY KEY,
        original_path TEXT NOT NULL,
        wrong_category TEXT NOT NULL,
        correct_category TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS corrections_recent ON corrections(id DESC);
    `);
  }
}

type CorrectionRow = {
  id: number;
  original_path: string;
  wrong_category: string;
  correct_category: string;
  note: string | null;
  created_at: string;
};

function mapRow(row: CorrectionRow): Correction {
  return {
    id: row.id,
    originalPath: row.original_path,
    wrongCategory: row.wrong_category,
    correctCategory: row.correct_category,
    note: row.note,
    createdAt: row.created_at,
  };
}
