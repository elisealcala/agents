import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Manager } from "../application/manager.ts";
import { Store } from "../storage/store.ts";
import { appRouter } from "./router.ts";

const roots: string[] = [];
const stores: Store[] = [];

async function context() {
  const root = await mkdtemp(path.join(os.tmpdir(), "delivery-binding-"));
  roots.push(root);
  const filename = path.join(root, "manager.sqlite");
  const store = new Store(filename);
  stores.push(store);
  const caller = appRouter.createCaller({
    manager: { store } as Manager,
    model: "fixture",
  });
  return { store, caller, filename };
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // Reopen tests close the first instance explicitly.
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local repository binding", () => {
  it("persists both known repository identities without changing existing project state", async () => {
    const { store, caller, filename } = await context();
    const project = store.create("Existing project");
    const agents = await caller.delivery.bindKnownRepository({
      name: "agents",
    });
    const choreDesign = await caller.delivery.bindKnownRepository({
      name: "chore-design",
    });
    expect(agents.identity).toEqual({
      provider: "github",
      repositoryId: "1355217430",
      owner: "elisealcala",
      name: "agents",
    });
    expect(choreDesign.identity).toEqual({
      provider: "github",
      repositoryId: "1437904422",
      owner: "elisealcala",
      name: "chore-design",
    });
    expect(store.get(project.id)).toEqual(project);
    store.close();
    const reopened = new Store(filename);
    stores.push(reopened);
    expect(
      reopened.delivery.listRepositories().map((item) => item.identity),
    ).toEqual(expect.arrayContaining([agents.identity, choreDesign.identity]));
    expect(reopened.get(project.id)).toEqual(project);
  });

  it("returns the same binding for repeated requests without overwriting it", async () => {
    const { caller } = await context();
    const first = await caller.delivery.bindKnownRepository({ name: "agents" });
    expect(
      await caller.delivery.bindKnownRepository({ name: "agents" }),
    ).toEqual(first);
    expect(await caller.delivery.repositories()).toEqual([first]);
  });

  it("rejects an invalid repository name or unexpected fields without creating a binding", async () => {
    const { caller } = await context();
    await expect(
      caller.delivery.bindKnownRepository({ name: "other" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.delivery.bindKnownRepository({
        name: "agents",
        repositoryId: "evil",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.delivery.repositories()).toEqual([]);
  });

  it("rejects an existing conflicting identity without overwriting it", async () => {
    const { store, caller } = await context();
    const existing = store.delivery.registerRepository({
      provider: "github",
      repositoryId: "1355217430",
      owner: "someone-else",
      name: "agents",
    });
    await expect(
      caller.delivery.bindKnownRepository({ name: "agents" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.delivery.getRepository("1355217430")).toEqual(existing);
    expect(await caller.delivery.repositories()).toEqual([existing]);
  });
});
