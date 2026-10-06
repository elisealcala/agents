import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EvaluationReport,
  Model,
  Snapshot,
  Worker,
} from "../application/contracts.ts";
import { Manager } from "../application/manager.ts";
import { Store } from "../storage/store.ts";
import { appRouter } from "./router.ts";

const directories: string[] = [];
const stores: Store[] = [];
const managers: Manager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function context() {
  const root = await mkdtemp(path.join(os.tmpdir(), "manager-router-"));
  directories.push(root);
  const store = new Store(path.join(root, "manager.sqlite"));
  stores.push(store);
  const snapshots = new Map<string, Snapshot>();
  const ingest = vi.fn<Worker["ingest"]>(async (input) => {
    const documentRef = `${input.projectId}:${input.sourceId}:${input.sourceVersion}`;
    const snapshot: Snapshot = {
      projectId: input.projectId,
      documentRef,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      markdown: input.markdown,
      sourceDate: input.sourceDate ?? null,
      checksum: createHash("sha256").update(input.markdown).digest("hex"),
    };
    snapshots.set(documentRef, snapshot);
    return {
      projectId: input.projectId,
      documentRef,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      checksum: snapshot.checksum,
      storageStatus: "stored",
      indexStatus: "ready",
      error: null,
    };
  });
  const read = vi.fn<Worker["read"]>(async (projectId, documentRef) => {
    const snapshot = snapshots.get(documentRef);
    if (!snapshot || snapshot.projectId !== projectId) {
      throw new Error("Evidence does not belong to this project");
    }
    return structuredClone(snapshot);
  });
  const worker: Worker = {
    identity: vi.fn(async () => ({ root })),
    ingest,
    read,
    search: vi.fn(async () => ({ passages: [], missingEmbeddings: 0 })),
  };
  const extract = vi.fn<Model["extract"]>(async (snapshot) => [
    {
      entity: "Release task",
      field: "owner",
      value: snapshot.markdown.includes("Grace") ? "Grace" : "Ada",
      quote: snapshot.markdown,
      effectiveDate: snapshot.sourceDate,
    },
  ]);
  const answer = vi.fn<Model["answer"]>(async (input) => ({
    factIds: input.approved.map((fact) => fact.id),
    questions: input.approved.length ? [] : ["Who should own Release task?"],
  }));
  const model: Model = { name: "fixture", extract, answer };
  const manager = new Manager(store, worker, model, { libraryRoot: root });
  managers.push(manager);
  const caller = appRouter.createCaller({ manager, model: model.name });
  return {
    root,
    store,
    manager,
    caller,
    worker,
    ingest,
    read,
    extract,
    answer,
  };
}

type Context = Awaited<ReturnType<typeof context>>;

async function completed(ctx: Context, projectId: string, runId: string) {
  await vi.waitFor(
    async () => {
      const run = await ctx.caller.runs.get({ projectId, runId });
      expect(run.status).not.toBe("running");
    },
    { timeout: 5_000 },
  );
  return ctx.caller.runs.get({ projectId, runId });
}

async function submit(ctx: Context, projectId: string, owner = "Ada") {
  const input = {
    projectId,
    sourceId: "standup",
    sourceVersion: "1",
    markdown: `Release task owner: ${owner}.`,
    sourceDate: "2026-10-05",
  };
  const started = await ctx.caller.notes.submit(input);
  const run = await completed(ctx, projectId, started.id);
  expect(run.status).toBe("success");
  return { input, run };
}

describe("project-manager router", () => {
  it("exposes manager identity and persists explicit project selection", async () => {
    const ctx = await context();
    expect(await ctx.caller.agent.identity()).toEqual({
      id: "project-manager",
      kind: "project-manager",
      name: "Project manager",
      model: "fixture",
    });
    const atlas = await ctx.caller.projects.create({ name: "  Atlas  " });
    const atlasMobile = await ctx.caller.projects.create({
      name: "Atlas Mobile",
    });

    expect(atlas.name).toBe("Atlas");
    expect(atlasMobile.id).not.toBe(atlas.id);
    expect(await ctx.caller.projects.list()).toEqual([atlasMobile, atlas]);
    expect(await ctx.caller.projects.get({ projectId: atlas.id })).toEqual(
      atlas,
    );
    expect(atlas.approved).toEqual([]);
    expect(atlas.revision).toBe(0);
  });

  it("keeps pending facts outside chat and makes an accepted fact citable", async () => {
    const ctx = await context();
    const project = await ctx.caller.projects.create({ name: "Atlas" });
    const { run } = await submit(ctx, project.id);
    const pending = await ctx.caller.reviews.list({ projectId: project.id });
    expect(pending).toHaveLength(1);
    expect(ctx.extract).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: "Release task owner: Ada." }),
      expect.any(Function),
    );
    expect(run.spans.map((span) => span.name)).toEqual([
      "registration",
      "extraction",
      "reconciliation",
    ]);

    const unreviewed = await ctx.caller.conversations.send({
      projectId: project.id,
      question: "Who owns Release task?",
    });
    const beforeReview = await completed(ctx, project.id, unreviewed.id);
    expect(beforeReview.output).toMatchObject({
      status: "clarification",
      claims: [],
      pendingReview: 1,
    });
    expect(ctx.answer.mock.calls[0]?.[0].approved).toEqual([]);

    const reviewed = await ctx.caller.reviews.resolve({
      projectId: project.id,
      candidateId: pending[0]!.id,
      expectedRevision: 0,
      action: "accept",
    });
    expect(reviewed.revision).toBe(1);
    expect(reviewed.history).toHaveLength(1);
    expect(await ctx.caller.reviews.list({ projectId: project.id })).toEqual(
      [],
    );

    const answered = await ctx.caller.conversations.send({
      projectId: project.id,
      conversationId: reviewed.conversations[0]!.id,
      question: "Who owns Release task now?",
    });
    const final = await completed(ctx, project.id, answered.id);
    expect(final.status).toBe("success");
    expect(final.output).toMatchObject({
      status: "answered",
      pendingReview: 0,
      claims: [
        {
          entity: "Release task",
          field: "owner",
          value: "Ada",
          evidence: { quote: "Release task owner: Ada." },
        },
      ],
    });
    expect(ctx.answer.mock.calls[1]?.[0].maxTurns).toBe(6);
    const saved = await ctx.caller.projects.get({ projectId: project.id });
    expect(saved.conversations).toHaveLength(1);
    expect(saved.conversations[0]?.messages).toHaveLength(2);
    expect(saved.conversations[0]?.messages[1]?.answer).toEqual(final.output);
    const citation = reviewed.approved[0]!.evidence;
    const source = await ctx.caller.evidence.read({
      projectId: project.id,
      documentRef: citation.documentRef,
    });
    expect(source.markdown.slice(citation.start, citation.end)).toBe(
      citation.quote,
    );
  });

  it("rejects runs, citations, conversations and candidates from another project", async () => {
    const ctx = await context();
    const atlas = await ctx.caller.projects.create({ name: "Atlas" });
    const mobile = await ctx.caller.projects.create({ name: "Atlas Mobile" });
    const { run } = await submit(ctx, atlas.id);
    const atlasState = await ctx.caller.projects.get({ projectId: atlas.id });
    const candidate = atlasState.candidates[0]!;
    const question = await ctx.caller.conversations.send({
      projectId: atlas.id,
      question: "Who owns Release task?",
    });
    await completed(ctx, atlas.id, question.id);
    const conversation = ctx.store.get(atlas.id).conversations[0]!;

    await expect(
      ctx.caller.runs.get({ projectId: mobile.id, runId: run.id }),
    ).rejects.toThrow("Run does not belong to this project");
    expect(await ctx.caller.runs.list({ projectId: mobile.id })).toEqual([]);
    const readCount = ctx.read.mock.calls.length;
    await expect(
      ctx.caller.evidence.read({
        projectId: mobile.id,
        documentRef: candidate.evidence.documentRef,
      }),
    ).rejects.toThrow("Evidence does not belong to this project");
    expect(ctx.read).toHaveBeenCalledTimes(readCount);
    await expect(
      ctx.caller.conversations.send({
        projectId: mobile.id,
        conversationId: conversation.id,
        question: "Who owns Release task?",
      }),
    ).rejects.toThrow("Conversation does not belong to this project");
    await expect(
      ctx.caller.reviews.resolve({
        projectId: mobile.id,
        candidateId: candidate.id,
        expectedRevision: 0,
        action: "accept",
      }),
    ).rejects.toThrow("Candidate is not pending review");
    await expect(
      ctx.caller.notes.retry({
        projectId: mobile.id,
        noteId: atlasState.notes[0]!.id,
      }),
    ).rejects.toThrow("Unknown note");
    await ctx.caller.reviews.resolve({
      projectId: atlas.id,
      candidateId: candidate.id,
      expectedRevision: 0,
      action: "accept",
    });
    const mobileQuestion = await ctx.caller.conversations.send({
      projectId: mobile.id,
      question: "Who owns Release task?",
    });
    const mobileAnswer = await completed(ctx, mobile.id, mobileQuestion.id);
    expect(mobileAnswer.output).toMatchObject({ claims: [] });
    expect(ctx.answer.mock.calls.at(-1)?.[0].approved).toEqual([]);
    const mobileState = await ctx.caller.projects.get({ projectId: mobile.id });
    expect(mobileState.approved).toEqual([]);
    expect(mobileState.conversations).toHaveLength(1);
    expect(mobileState.revision).toBe(0);
    expect(ctx.store.get(atlas.id).approved[0]?.value).toBe("Ada");
  });

  it("records reviewer corrections as human evidence and prevents stale review writes", async () => {
    const ctx = await context();
    const project = await ctx.caller.projects.create({ name: "Atlas" });
    await submit(ctx, project.id);
    const candidate = ctx.store.get(project.id).candidates[0]!;
    const edited = await ctx.caller.reviews.resolve({
      projectId: project.id,
      candidateId: candidate.id,
      expectedRevision: 0,
      action: "edit",
      value: "  Grace  ",
      effectiveDate: "2026-10-06",
    });

    expect(edited.approved[0]).toMatchObject({
      value: "Grace",
      effectiveDate: "2026-10-06",
      evidence: { kind: "human", quote: "Grace", projectId: project.id },
    });
    expect(edited.reviews[0]).toMatchObject({
      original: { value: "Ada", evidence: { kind: "document" } },
      correction: { value: "Grace", effectiveDate: "2026-10-06" },
    });
    const calls = ctx.read.mock.calls.length;
    const confirmation = await ctx.caller.evidence.read({
      projectId: project.id,
      documentRef: edited.approved[0]!.evidence.documentRef,
    });
    expect(confirmation.markdown).toBe("Grace");
    expect(ctx.read).toHaveBeenCalledTimes(calls);
    await expect(
      ctx.caller.reviews.resolve({
        projectId: project.id,
        candidateId: candidate.id,
        expectedRevision: 0,
        action: "reject",
      }),
    ).rejects.toThrow("Project revision changed; refresh before reviewing");
    expect(ctx.store.get(project.id).revision).toBe(1);
    expect(ctx.store.get(project.id).approved[0]?.value).toBe("Grace");
  });

  it("returns the original run for duplicate source versions without extracting twice", async () => {
    const ctx = await context();
    const project = await ctx.caller.projects.create({ name: "Atlas" });
    const { input, run } = await submit(ctx, project.id);

    const duplicate = await ctx.caller.notes.submit(input);
    expect(duplicate.id).toBe(run.id);
    expect(ctx.ingest).toHaveBeenCalledOnce();
    expect(ctx.extract).toHaveBeenCalledOnce();
    expect(ctx.store.get(project.id).notes).toHaveLength(1);
    expect(ctx.store.get(project.id).candidates).toHaveLength(1);
    await expect(
      ctx.caller.notes.submit({ ...input, markdown: "Changed contents." }),
    ).rejects.toThrow("Source version already belongs to different content");
    await expect(
      ctx.caller.notes.submit({ ...input, sourceDate: "2026-10-06" }),
    ).rejects.toThrow("Source version already belongs to different content");
  });

  it("persists intake errors and retries using the original idempotency key", async () => {
    const ctx = await context();
    const project = await ctx.caller.projects.create({ name: "Atlas" });
    ctx.ingest.mockRejectedValueOnce(
      new Error("Worker temporarily unavailable"),
    );
    const started = await ctx.caller.notes.submit({
      projectId: project.id,
      sourceId: "standup",
      sourceVersion: "1",
      markdown: "Release task owner: Ada.",
      sourceDate: "2026-10-05",
    });
    const failed = await completed(ctx, project.id, started.id);
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("Worker temporarily unavailable");
    const note = ctx.store.get(project.id).notes[0]!;
    expect(note.status).toBe("error");
    expect(ctx.store.get(project.id).approved).toEqual([]);

    const retried = await ctx.caller.notes.retry({
      projectId: project.id,
      noteId: note.id,
    });
    expect(retried.id).not.toBe(failed.id);
    const recovered = await completed(ctx, project.id, retried.id);
    expect(recovered.status).toBe("success");
    expect(
      ctx.ingest.mock.calls.map(([input]) => input.idempotencyKey),
    ).toEqual([note.id, note.id]);
    expect(ctx.store.get(project.id).candidates).toHaveLength(1);
    expect(ctx.store.getRun(failed.id).error).toBe(
      "Worker temporarily unavailable",
    );
  });

  it("rejects invalid identifiers, empty text, malformed dates and invalid Markdown", async () => {
    const ctx = await context();
    const project = await ctx.caller.projects.create({ name: "Atlas" });
    await expect(ctx.caller.projects.create({ name: " " })).rejects.toThrow();
    await expect(
      ctx.caller.projects.get({ projectId: "not-a-project-id" }),
    ).rejects.toThrow();
    await expect(
      ctx.caller.projects.get({ projectId: randomUUID() }),
    ).rejects.toThrow("Unknown project");
    await expect(
      ctx.caller.conversations.send({ projectId: project.id, question: " " }),
    ).rejects.toThrow();
    const note = {
      projectId: project.id,
      sourceId: "standup",
      sourceVersion: "1",
      markdown: "Release task owner: Ada.",
    };
    for (const markdown of [" ", "\ud800", "x".repeat(30001)]) {
      await expect(
        ctx.caller.notes.submit({ ...note, markdown }),
      ).rejects.toThrow();
    }
    await expect(
      ctx.caller.notes.submit({ ...note, sourceDate: "2026-02-30" }),
    ).rejects.toThrow("Use a valid ISO date");
    await expect(
      ctx.caller.reviews.resolve({
        projectId: project.id,
        candidateId: randomUUID(),
        expectedRevision: -1,
        action: "accept",
      }),
    ).rejects.toThrow();
    expect(ctx.ingest).not.toHaveBeenCalled();
    expect(ctx.answer).not.toHaveBeenCalled();
    expect(ctx.store.get(project.id).notes).toEqual([]);
    expect(ctx.store.runs(project.id)).toEqual([]);
  });

  it("exposes persisted evaluation metrics as a read-only report", async () => {
    const ctx = await context();
    const report: EvaluationReport = {
      id: "eval-fixture",
      createdAt: "2026-10-05T00:00:00.000Z",
      datasetVersion: "v1",
      datasetChecksum: "frozen-fixture-checksum",
      mode: "fixture",
      model: "fixture",
      promptVersion: "project-facts-v1",
      split: "holdout",
      metrics: {
        precision: {
          numerator: 9,
          denominator: 10,
          value: 0.9,
          target: 0.98,
          passed: false,
        },
      },
      failures: [
        {
          caseId: "question-1",
          module: "answers",
          reason: "Unsupported claim",
        },
      ],
      metadata: { maxTurns: 6 },
    };
    ctx.store.saveEvaluation(report);
    expect(await ctx.caller.evaluations.list()).toEqual([report]);
    expect(await ctx.caller.evaluations.get({ id: report.id })).toEqual(report);
    await expect(
      ctx.caller.evaluations.get({ id: "missing-report" }),
    ).rejects.toThrow("Unknown evaluation");
  });
});
