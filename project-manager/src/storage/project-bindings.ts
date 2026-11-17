/** Durable repository -> existing Project bindings (immutable ids only). */
import type {
  ProjectBindingRecord,
  ProjectBindingSink,
  ProjectFieldMapping,
} from "../integrations/github/projects.ts";
import type { SqlDriver } from "./sql-driver.ts";

type Row = {
  repository_id: number;
  project_id: string;
  project_number: number;
  mapping: string;
};

export class ProjectBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectBindingError";
  }
}

export class ProjectBindingStore implements ProjectBindingSink {
  constructor(private readonly db: SqlDriver) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS github_project_bindings(
      repository_id INTEGER PRIMARY KEY, project_id TEXT NOT NULL,
      project_number INTEGER NOT NULL, mapping TEXT NOT NULL);`);
  }

  /** Idempotent for an identical binding; a different existing binding is never overwritten. */
  bind(record: ProjectBindingRecord): ProjectBindingRecord {
    return this.db.transaction(() => {
      const existing = this.get(record.repositoryId);
      if (existing) {
        if (JSON.stringify(existing) === JSON.stringify(record))
          return existing;
        throw new ProjectBindingError("Repository already bound to a Project");
      }
      this.db
        .prepare(
          "INSERT INTO github_project_bindings(repository_id, project_id, project_number, mapping) VALUES (?, ?, ?, ?)",
        )
        .run(
          record.repositoryId,
          record.projectId,
          record.projectNumber,
          JSON.stringify(record.mapping),
        );
      return record;
    });
  }

  get(repositoryId: number): ProjectBindingRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM github_project_bindings WHERE repository_id=?")
      .get(repositoryId) as Row | undefined;
    if (!row) return undefined;
    const mapping = JSON.parse(row.mapping) as ProjectFieldMapping;
    return {
      repositoryId: row.repository_id,
      projectId: row.project_id,
      projectNumber: row.project_number,
      mapping: {
        statusFieldId: mapping.statusFieldId,
        statusOptionIds: mapping.statusOptionIds,
      },
    };
  }
}
