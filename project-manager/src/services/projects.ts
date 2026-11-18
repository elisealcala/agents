import { randomUUID } from "node:crypto";
import type { ProjectsRepository } from "../contracts/projects.ts";
import {
  createProject,
  normalizeProjectName,
  type Project,
} from "../domain/projects.ts";

export class ProjectsService {
  constructor(
    private readonly repository: ProjectsRepository,
    private readonly creation: {
      createId: () => string;
      now: () => string;
    } = {
      createId: randomUUID,
      now: () => new Date().toISOString(),
    },
  ) {}

  create(name: string): Project {
    const normalized = normalizeProjectName(name);
    const project = createProject({
      id: this.creation.createId(),
      name: normalized,
      createdAt: this.creation.now(),
    });
    this.repository.save(project);
    return project;
  }

  list(): Project[] {
    return this.repository.list();
  }

  get(id: string): Project {
    return this.repository.get(id);
  }
}
