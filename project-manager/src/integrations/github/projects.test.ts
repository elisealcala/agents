import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createNodeSqlDriver } from "../../storage/sql-driver.ts";
import {
  ProjectBindingError,
  ProjectBindingStore,
} from "../../storage/project-bindings.ts";
import { GitHubTransportError } from "./client.ts";
import {
  adoptProject,
  discoverProjects,
  type GitHubProjectsTransport,
  type ProjectField,
} from "./projects.ts";

const status: ProjectField = {
  id: "F_status",
  name: "Status",
  type: "single_select",
  options: [
    { id: "o1", name: "Todo" },
    { id: "o2", name: "Done" },
  ],
};
const project = { id: "P_1", number: 1, title: "Board", ownerLogin: "me" };

function transport(
  fields: ProjectField[],
  error?: GitHubTransportError,
): GitHubProjectsTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listOwnerProjects() {
      calls.push("projects");
      if (error) throw error;
      return [project];
    },
    async listProjectFields() {
      calls.push("fields");
      return fields;
    },
  };
}
function store() {
  return new ProjectBindingStore(
    createNodeSqlDriver(new DatabaseSync(":memory:")),
  );
}

describe("project discovery and adoption", () => {
  it("lists projects with fields and options", async () => {
    const result = await discoverProjects(transport([status]), "t");
    expect(result).toEqual({
      ok: true,
      value: [{ project, fields: [status] }],
    });
  });

  it("reports denied Projects access distinctly from other failures", async () => {
    const denied = await discoverProjects(
      transport([], new GitHubTransportError("forbidden")),
      "t",
    );
    expect(denied).toEqual({ ok: false, reason: "projects_access_denied" });
    const down = await discoverProjects(
      transport([], new GitHubTransportError("unavailable")),
      "t",
    );
    expect(down).toEqual({ ok: false, reason: "unavailable" });
  });

  it("adopts with immutable ids, read-only, and persists the binding", async () => {
    const t = transport([status]);
    const s = store();
    const result = await adoptProject(t, "t", s, {
      repositoryId: 7,
      projectId: "P_1",
    });
    expect(result.ok).toBe(true);
    expect(t.calls).toEqual(["projects", "fields"]);
    expect(s.get(7)).toEqual({
      repositoryId: 7,
      projectId: "P_1",
      projectNumber: 1,
      mapping: { statusFieldId: "F_status", statusOptionIds: ["o1", "o2"] },
    });
  });

  it("requires explicit mapping for renamed, ambiguous or missing fields", async () => {
    const renamed = { ...status, name: "Stage" };
    const dup = { ...status, id: "F_2" };
    for (const fields of [[renamed], [status, dup], []]) {
      const s = store();
      const result = await adoptProject(transport(fields), "t", s, {
        repositoryId: 1,
        projectId: "P_1",
      });
      expect(result).toMatchObject({ ok: false, reason: "mapping_required" });
      expect(s.get(1)).toBeUndefined();
    }
    const explicit = await adoptProject(transport([renamed]), "t", store(), {
      repositoryId: 1,
      projectId: "P_1",
      fieldMapping: { statusFieldId: "F_status" },
    });
    expect(explicit.ok).toBe(true);
    const bad = await adoptProject(transport([status]), "t", store(), {
      repositoryId: 1,
      projectId: "P_1",
      fieldMapping: { statusFieldId: "missing" },
    });
    expect(bad).toMatchObject({ ok: false, reason: "mapping_invalid" });
  });

  it("is idempotent but never overwrites a different binding", async () => {
    const s = store();
    const input = { repositoryId: 3, projectId: "P_1" };
    await adoptProject(transport([status]), "t", s, input);
    const again = await adoptProject(transport([status]), "t", s, input);
    expect(again.ok).toBe(true);
    const changed = { ...status, options: [{ id: "o9", name: "New" }] };
    await expect(
      adoptProject(transport([changed]), "t", s, input),
    ).rejects.toThrow(ProjectBindingError);
    expect(s.get(3)?.mapping.statusOptionIds).toEqual(["o1", "o2"]);
  });
});
