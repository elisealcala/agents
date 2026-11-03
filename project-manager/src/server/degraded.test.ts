import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Candidate,
  Model,
  Note,
  Worker,
} from "../application/contracts.ts";
import { Manager } from "../application/manager.ts";
import { Store } from "../storage/store.ts";
import { appRouter } from "./router.ts";
import { resolveRuntimeConfig } from "./runtime-config.ts";

const roots: string[] = [];
const stores: Store[] = [];
const managers: Manager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function context() {
  const root = await mkdtemp(path.join(os.tmpdir(), "manager-degraded-"));
  roots.push(root);
  const store = new Store(path.join(root, "manager.sqlite"));
  stores.push(store);
  const worker: Worker = {
    identity: vi.fn(),
    ingest: vi.fn(),
    read: vi.fn(),
    search: vi.fn(),
  };
  const model: Model = { name: "fixture", extract: vi.fn(), answer: vi.fn() };
  const manager = new Manager(store, worker, model, {
    canIntake: false,
    canAnswer: false,
  });
  managers.push(manager);
  const config = resolveRuntimeConfig({
    PROJECT_MANAGER_LIBRARY_ROOT: "relative/private-path",
    ANTHROPIC_API_KEY: "private-api-key-fixture",
    PROJECT_MANAGER_CLASSIFIER_URL:
      "https://user:private-password@classifier.invalid",
  });
  const caller = appRouter.createCaller({
    manager,
    model: "unconfigured",
    capabilities: config.capabilities,
  });
  return { store, manager, caller, worker, model, config };
}

function pendingCandidate(projectId: string): Candidate {
  return {
    id: randomUUID(),
    noteId: randomUUID(),
    entity: "Release task",
    field: "owner",
    value: "Ada",
    effectiveDate: null,
    evidence: {
      kind: "document",
      projectId,
      documentRef: "fixture-source",
      checksum: "fixture-checksum",
      sourceVersion: "1",
      start: 0,
      end: 3,
      quote: "Ada",
    },
    status: "pending",
    conflict: false,
    historical: false,
    createdAt: "2026-11-01T00:00:00.000Z",
  };
}

describe("degraded manager configuration", () => {
  it("returns only configuration states and never provider secrets or paths", async () => {
    const { caller, config } = await context();
    const status = await caller.agent.configuration();
    expect(status).toEqual({
      evidence: "unconfigured",
      model: "unconfigured",
      intake: "unconfigured",
      conversation: "unconfigured",
    });
    expect(status).toEqual(config.capabilities);
    expect(JSON.stringify(status)).not.toContain("private-api-key-fixture");
    expect(JSON.stringify(status)).not.toContain("private-password");
    expect(JSON.stringify(status)).not.toContain("relative/private-path");
  });

  it("rejects intake, retry, and conversation before recording any changes or contacting providers", async () => {
    const { caller, store, worker, model } = await context();
    const project = await caller.projects.create({ name: "Existing project" });
    const note: Note = {
      id: randomUUID(),
      sourceId: "meeting",
      sourceVersion: "1",
      markdown: "Existing original",
      sourceDate: null,
      checksum: "checksum",
      documentRef: null,
      status: "error",
      indexStatus: null,
      runId: randomUUID(),
      error: "Previous failure",
    };
    project.notes.push(note);
    store.save(project);
    const before = store.get(project.id);

    await expect(
      caller.notes.submit({
        projectId: project.id,
        sourceId: "new",
        sourceVersion: "1",
        markdown: "New source",
      }),
    ).rejects.toThrow(/unavailable/i);
    await expect(
      caller.notes.retry({ projectId: project.id, noteId: note.id }),
    ).rejects.toThrow(/unavailable/i);
    await expect(
      caller.conversations.send({
        projectId: project.id,
        question: "What is next?",
      }),
    ).rejects.toThrow(/unavailable/i);
    expect(await caller.projects.get({ projectId: project.id })).toEqual(
      before,
    );
    expect(await caller.runs.list({ projectId: project.id })).toEqual([]);
    expect(worker.identity).not.toHaveBeenCalled();
    expect(worker.ingest).not.toHaveBeenCalled();
    expect(worker.read).not.toHaveBeenCalled();
    expect(worker.search).not.toHaveBeenCalled();
    expect(model.extract).not.toHaveBeenCalled();
    expect(model.answer).not.toHaveBeenCalled();
  });

  it("keeps existing project, pending review, and human confirmation source available", async () => {
    const { caller, store, worker } = await context();
    const project = await caller.projects.create({ name: "Reviewed project" });
    const candidate = pendingCandidate(project.id);
    project.candidates.push(candidate);
    store.save(project);
    expect(await caller.projects.list()).toEqual([project]);
    expect(await caller.reviews.list({ projectId: project.id })).toEqual([
      candidate,
    ]);

    const reviewed = await caller.reviews.resolve({
      projectId: project.id,
      candidateId: candidate.id,
      action: "edit",
      value: "Grace",
      expectedRevision: project.revision,
    });
    expect(reviewed.approved).toHaveLength(1);
    const evidence = reviewed.approved[0].evidence;
    expect(evidence).toMatchObject({
      kind: "human",
      projectId: project.id,
      quote: "Grace",
    });
    const source = await caller.evidence.read({
      projectId: project.id,
      documentRef: evidence.documentRef,
    });
    expect(source).toMatchObject({
      projectId: project.id,
      documentRef: evidence.documentRef,
      markdown: "Grace",
      checksum: createHash("sha256").update("Grace").digest("hex"),
    });
    expect(await caller.reviews.list({ projectId: project.id })).toEqual([]);
    expect(worker.identity).not.toHaveBeenCalled();
    expect(worker.read).not.toHaveBeenCalled();
  });
});
