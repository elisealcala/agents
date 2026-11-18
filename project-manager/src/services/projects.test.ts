import { describe, expect, it, vi } from "vitest";
import type { ProjectsRepository } from "../contracts/projects.ts";
import type { Project } from "../domain/projects.ts";
import { ProjectsService } from "./projects.ts";

const id = "1c04d51b-c4d3-4bc7-9a9e-9c006834ea60";
const createdAt = "2026-11-18T12:00:00.000Z";

function context() {
  const records = new Map<string, Project>();
  const repository: ProjectsRepository = {
    list: vi.fn(() => [...records.values()]),
    get: vi.fn((projectId) => {
      const project = records.get(projectId);
      if (!project) throw new Error("Unknown project");
      return project;
    }),
    save: vi.fn((project) => {
      records.set(project.id, project);
    }),
  };
  const creation = {
    createId: vi.fn(() => id),
    now: vi.fn(() => createdAt),
  };
  return {
    repository,
    creation,
    service: new ProjectsService(repository, creation),
  };
}

describe("projects service", () => {
  it("creates and persists the complete initial aggregate with a normalized name", () => {
    const { service, repository } = context();
    const project = service.create("  Atlas \n");
    expect(project).toEqual({
      id,
      name: "Atlas",
      revision: 0,
      createdAt,
      notes: [],
      candidates: [],
      approved: [],
      history: [],
      reviews: [],
      conversations: [],
    });
    expect(repository.save).toHaveBeenCalledExactlyOnceWith(project);
    expect(service.list()).toEqual([project]);
    expect(service.get(id)).toEqual(project);
    expect(repository.get).toHaveBeenCalledExactlyOnceWith(id);
  });

  it.each([1, 200])(
    "accepts a normalized creation name with %i characters",
    (length) => {
      const { service } = context();
      const name = "a".repeat(length);
      expect(service.create(` ${name} `).name).toBe(name);
    },
  );

  it.each([
    ["empty", ""],
    ["whitespace", " \t\n"],
    ["overlong", "a".repeat(201)],
  ])(
    "rejects %s creation names before generating identity or saving",
    (_label, name) => {
      const { service, repository, creation } = context();
      expect(() => service.create(name)).toThrow(
        "Project name must contain between 1 and 200 characters",
      );
      expect(repository.save).not.toHaveBeenCalled();
      expect(creation.createId).not.toHaveBeenCalled();
      expect(creation.now).not.toHaveBeenCalled();
      expect(service.list()).toEqual([]);
    },
  );

  it("uses UUID and ISO timestamp defaults when no creation dependencies are supplied", () => {
    const { repository } = context();
    const project = new ProjectsService(repository).create("Atlas");
    expect(project.id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
    expect(new Date(project.createdAt).toISOString()).toBe(project.createdAt);
    expect(repository.get(project.id)).toEqual(project);
  });

  it("propagates missing-project errors through its read use case", () => {
    const { service } = context();
    expect(() => service.get("missing")).toThrow("Unknown project");
  });

  it("propagates persistence failures instead of returning an unsaved project", () => {
    const { service, repository } = context();
    const failure = new Error("Storage unavailable");
    vi.mocked(repository.save).mockImplementation(() => {
      throw failure;
    });
    expect(() => service.create("Atlas")).toThrow(failure);
    expect(service.list()).toEqual([]);
    vi.mocked(repository.list).mockImplementation(() => {
      throw failure;
    });
    expect(() => service.list()).toThrow(failure);
  });
});
