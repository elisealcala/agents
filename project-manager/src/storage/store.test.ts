import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Run } from "../application/contracts.ts";
import { Store } from "./store.ts";

const roots: string[] = [];
const stores: Store[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      /* Restart tests close the first connection. */
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "manager-store-test-"));
  roots.push(root);
  const filename = path.join(root, "state", "manager.sqlite");
  const store = new Store(filename);
  stores.push(store);
  return { store, filename };
}

describe("durable manager state", () => {
  it("marks interrupted runs, spans and intake records failed on restart without losing source content", async () => {
    const { store, filename } = await setup();
    const project = store.create("Atlas");
    const run: Run = {
      id: randomUUID(),
      projectId: project.id,
      action: "intake",
      status: "running",
      input: { sourceId: "meeting" },
      output: null,
      error: null,
      startedAt: "2026-10-05T00:00:00Z",
      endedAt: null,
      spans: [
        {
          id: randomUUID(),
          parentId: null,
          name: "registration",
          kind: "tool",
          status: "running",
          input: null,
          output: null,
          error: null,
          startedAt: "2026-10-05T00:00:00Z",
          endedAt: null,
        },
      ],
    };
    project.notes.push({
      id: randomUUID(),
      sourceId: "meeting",
      sourceVersion: "1",
      markdown: "Original source",
      sourceDate: "2026-10-05",
      checksum: "checksum",
      documentRef: null,
      status: "storing",
      indexStatus: null,
      runId: run.id,
      error: null,
    });
    store.commit(project, run);
    store.close();
    const reopened = new Store(filename);
    stores.push(reopened);
    expect(reopened.getRun(run.id)).toMatchObject({
      status: "error",
      error: expect.stringContaining("restarted"),
      endedAt: expect.any(String),
      spans: [
        expect.objectContaining({
          status: "failed",
          endedAt: expect.any(String),
        }),
      ],
    });
    expect(reopened.get(project.id).notes[0]).toMatchObject({
      status: "error",
      markdown: "Original source",
      sourceVersion: "1",
      error: expect.stringContaining("same source/version"),
    });
  });

  it("returns detached records and reports unknown identities", async () => {
    const { store } = await setup();
    const project = store.create("Atlas");
    const read = store.get(project.id);
    read.name = "Mutated local copy";
    expect(store.get(project.id).name).toBe("Atlas");
    expect(() => store.get("missing")).toThrow("Unknown project");
    expect(() => store.getRun("missing")).toThrow("Unknown run");
    expect(() => store.getEvaluation("missing")).toThrow("Unknown evaluation");
  });
});
