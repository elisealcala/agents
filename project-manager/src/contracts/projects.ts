import type { Project } from "../domain/projects.ts";

/** Synchronous persistence port; the existing manager owns transactions. */
export interface ProjectsRepository {
  list(): Project[];
  get(id: string): Project;
  save(project: Project): void;
}
