/** Preserve the existing JSON aggregate table and migration version. */
export const projectTableSql =
  "CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);";

export type ProjectRow = { id: string; data: string };
