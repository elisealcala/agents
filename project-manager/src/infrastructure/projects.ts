import type { ProjectsRepository } from "../contracts/projects.ts";
import type { ProjectRow } from "../db/schema/project.ts";
import type { Project } from "../domain/projects.ts";
import type { SqlDriver } from "../storage/sql-driver.ts";

/** Uses the owner's driver so saves participate in its existing transaction. */
export class SqlProjectsRepository implements ProjectsRepository {
  constructor(private readonly db: SqlDriver) {}

  list(): Project[] {
    const rows = this.db
      .prepare("SELECT data FROM projects ORDER BY rowid DESC")
      .all() as Pick<ProjectRow, "data">[];
    return rows.map((row) => JSON.parse(row.data) as Project);
  }

  get(id: string): Project {
    const row = this.db
      .prepare("SELECT data FROM projects WHERE id=?")
      .get(id) as Pick<ProjectRow, "data"> | undefined;
    if (!row) throw new Error("Unknown project");
    return JSON.parse(row.data) as Project;
  }

  save(project: Project): void {
    this.db
      .prepare(
        "INSERT INTO projects(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(project.id, JSON.stringify(project));
  }
}
