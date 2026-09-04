import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { EmbeddingProvider } from "./embeddings.ts";
import { SEED_CATEGORIES, type Category } from "./taxonomy.ts";

export type StoredCategory = Category & {
  embedding: number[] | null;
  embeddingProvider: string | null;
  isSeed: boolean;
  createdAt: string;
};

export type CategoryProposal = {
  name: string;
  definition: string;
};

export class CategoryStore {
  private readonly db: DatabaseSync;
  private readonly libraryFolder: string;

  constructor(databasePath: string, libraryRoot: string) {
    this.db = new DatabaseSync(path.resolve(databasePath));
    this.libraryFolder = path.join(path.resolve(libraryRoot), "library");
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
    this.seed();
  }

  close(): void {
    this.db.close();
  }

  async initialize(): Promise<void> {
    await mkdir(this.libraryFolder, { recursive: true });
    await Promise.all(
      this.list().map((category) =>
        mkdir(this.folderPath(category), { recursive: true }),
      ),
    );
  }

  list(): StoredCategory[] {
    return (this.db
      .prepare("SELECT * FROM categories ORDER BY is_seed DESC, created_at, id")
      .all() as CategoryRow[]).map(mapRow);
  }

  get(id: string): StoredCategory | null {
    const row = this.db
      .prepare("SELECT * FROM categories WHERE id = ?")
      .get(id) as CategoryRow | undefined;
    return row ? mapRow(row) : null;
  }

  folderPath(category: Pick<Category, "folder">): string {
    return path.join(this.libraryFolder, category.folder);
  }

  async ensureEmbeddings(provider: EmbeddingProvider): Promise<void> {
    for (const category of this.list()) {
      if (
        category.embedding &&
        category.embeddingProvider === provider.id &&
        category.embedding.length === provider.dimensions
      ) {
        continue;
      }
      const embedding = await provider.embed(categoryText(category));
      this.db
        .prepare(
          `UPDATE categories
           SET embedding_json = ?, embedding_provider = ? WHERE id = ?`,
        )
        .run(JSON.stringify(embedding), provider.id, category.id);
    }
  }

  async create(
    proposal: CategoryProposal,
    embedding: number[],
    embeddingProvider: string,
  ): Promise<StoredCategory> {
    const baseId = slugify(proposal.name, "_");
    const baseFolder = slugify(proposal.name, "-");
    if (!baseId || !baseFolder) throw new Error("category name must contain letters or numbers");

    let suffix = 1;
    let id = baseId;
    let folder = baseFolder;
    while (this.get(id)) {
      suffix += 1;
      id = `${baseId}_${suffix}`;
      folder = `${baseFolder}-${suffix}`;
    }

    this.db
      .prepare(
        `INSERT INTO categories
          (id, name, definition, folder, embedding_json, embedding_provider, is_seed)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        id,
        proposal.name.trim(),
        proposal.definition.trim(),
        folder,
        JSON.stringify(embedding),
        embeddingProvider,
      );
    const created = this.get(id)!;
    try {
      await mkdir(this.folderPath(created), { recursive: false });
    } catch (error) {
      this.db.prepare("DELETE FROM categories WHERE id = ?").run(id);
      throw error;
    }
    return created;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        definition TEXT NOT NULL,
        folder TEXT NOT NULL UNIQUE,
        embedding_json TEXT,
        embedding_provider TEXT,
        is_seed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  private seed(): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO categories
        (id, name, definition, folder, is_seed)
       VALUES (?, ?, ?, ?, 1)`,
    );
    for (const category of SEED_CATEGORIES) {
      insert.run(category.id, category.name, category.definition, category.folder);
    }
  }
}

export function categoryText(category: Pick<Category, "name" | "definition">): string {
  return `${category.name}: ${category.definition}`;
}

function slugify(value: string, separator: "_" | "-"): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "")
    .slice(0, 64);
}

type CategoryRow = {
  id: string;
  name: string;
  definition: string;
  folder: string;
  embedding_json: string | null;
  embedding_provider: string | null;
  is_seed: number;
  created_at: string;
};

function mapRow(row: CategoryRow): StoredCategory {
  return {
    id: row.id,
    name: row.name,
    definition: row.definition,
    folder: row.folder,
    embedding: row.embedding_json ? (JSON.parse(row.embedding_json) as number[]) : null,
    embeddingProvider: row.embedding_provider,
    isSeed: row.is_seed === 1,
    createdAt: row.created_at,
  };
}
