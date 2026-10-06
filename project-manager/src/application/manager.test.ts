import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FixtureModel } from "../../evals/fixture-model.ts";
import { FixtureWorker } from "../../evals/fixture-worker.ts";
import { Store } from "../storage/store.ts";
import type { Answer, Model, Worker } from "./contracts.ts";
import { Manager } from "./manager.ts";

const roots: string[] = [];
const managers: Manager[] = [];
const stores: Store[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      /* Tests also exercise restart. */
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const ownerQuote = 'Task "Cache" has owner "Ava" effective 2026-10-05.';
const dueQuote = 'Task "Cache" has due date "2026-10-20" effective 2026-10-05.';
function note(
  markdown = `${ownerQuote}\n\n${dueQuote}`,
  sourceId = "meeting-1",
) {
  return { sourceId, sourceVersion: "1", markdown, sourceDate: "2026-10-05" };
}

function model(overrides: Partial<Model> = {}): Model {
  const fixture = new FixtureModel();
  return {
    name: "test-model",
    extract: (snapshot, observe) => fixture.extract(snapshot, observe),
    answer: async (input) => ({
      factIds: input.approved.map((fact) => fact.id),
      questions: [],
    }),
    ...overrides,
  };
}

async function setup(
  options: {
    worker?: Worker;
    model?: Model;
    libraryRoot?: string;
    filename?: string;
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "manager-behavior-test-"));
  roots.push(root);
  const filename = options.filename ?? path.join(root, "manager.sqlite");
  const store = new Store(filename);
  stores.push(store);
  const worker = options.worker ?? new FixtureWorker();
  const configuredModel = options.model ?? model();
  const manager = new Manager(store, worker, configuredModel, {
    libraryRoot: options.libraryRoot,
  });
  managers.push(manager);
  const project = store.create("Atlas");
  return { manager, store, worker, project, filename };
}

async function settled(store: Store, runId: string) {
  await vi.waitFor(
    () => expect(store.getRun(runId).status).not.toBe("running"),
    { timeout: 5000 },
  );
  return store.getRun(runId);
}

describe("review-first manager", () => {
  it("extracts directly from the snapshot while approved state stays unchanged and chat cannot assert pending facts", async () => {
    const answer = vi.fn<Model["answer"]>(async (input) => {
      expect(input.approved).toEqual([]);
      const found = await input.search("Cache");
      expect(found.passages).toEqual([]);
      return { factIds: [], questions: ["Please approve the task owner."] };
    });
    const { manager, store, project } = await setup({
      model: model({ answer }),
    });
    const run = await settled(store, manager.submit(project.id, note()).id);
    expect(run.status).toBe("success");
    const state = store.get(project.id);
    expect(state.approved).toEqual([]);
    expect(state.revision).toBe(0);
    expect(state.candidates).toHaveLength(2);
    expect(
      state.candidates.map((candidate) => candidate.evidence.quote),
    ).toEqual([ownerQuote, dueQuote]);
    expect(run.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining(["registration", "extraction", "reconciliation"]),
    );
    const question = await settled(
      store,
      manager.ask(project.id, { question: "Who owns Cache?" }).id,
    );
    expect(question.output).toMatchObject({
      status: "clarification",
      claims: [],
      pendingReview: 2,
    });
    expect((question.output as Answer).text).toContain("await review");
    expect(store.get(project.id).approved).toEqual([]);
  });

  it("accepts or rejects individual facts and preserves original review decisions", async () => {
    const { manager, store, project } = await setup();
    await settled(store, manager.submit(project.id, note()).id);
    const candidates = store.get(project.id).candidates;
    manager.review(project.id, {
      candidateId: candidates[0]!.id,
      action: "accept",
      expectedRevision: 0,
    });
    const reviewed = manager.review(project.id, {
      candidateId: candidates[1]!.id,
      action: "reject",
      expectedRevision: 1,
    });
    expect(reviewed.approved).toEqual([
      expect.objectContaining({
        entity: "Cache",
        field: "owner",
        value: "Ava",
        revision: 1,
        evidence: expect.objectContaining({
          kind: "document",
          quote: ownerQuote,
        }),
      }),
    ]);
    expect(reviewed.history).toHaveLength(1);
    expect(reviewed.reviews.map((review) => review.original.status)).toEqual([
      "pending",
      "pending",
    ]);
    expect(reviewed.revision).toBe(1);
    const result = await settled(
      store,
      manager.ask(project.id, { question: "Who owns Cache?" }).id,
    );
    expect(result.status).toBe("success");
    expect(result.output).toMatchObject({
      claims: [expect.objectContaining({ value: "Ava" })],
      pendingReview: 0,
      suggestions: [],
    });
  });

  it("records reviewer corrections as separate human evidence and leaves document evidence intact", async () => {
    const { manager, store, project } = await setup();
    await settled(store, manager.submit(project.id, note(ownerQuote)).id);
    const candidate = store.get(project.id).candidates[0]!;
    const reviewed = manager.review(project.id, {
      candidateId: candidate.id,
      action: "edit",
      expectedRevision: 0,
      value: "Maya",
      effectiveDate: "2026-10-06",
    });
    const fact = reviewed.approved[0]!;
    expect(fact.evidence).toMatchObject({
      kind: "human",
      quote: "Maya",
      start: 0,
      end: 4,
    });
    expect(reviewed.reviews[0]).toMatchObject({
      original: { value: "Ava", evidence: { quote: ownerQuote } },
      correction: { value: "Maya", effectiveDate: "2026-10-06" },
    });
    expect(
      await manager.read(project.id, fact.evidence.documentRef),
    ).toMatchObject({ markdown: "Maya" });
    expect(
      await manager.read(project.id, candidate.evidence.documentRef),
    ).toMatchObject({ markdown: ownerQuote });
  });

  it("guards revisions, project ownership and completed review actions", async () => {
    const { manager, store, project } = await setup();
    await settled(store, manager.submit(project.id, note()).id);
    const [owner, due] = store.get(project.id).candidates;
    manager.review(project.id, {
      candidateId: owner!.id,
      action: "accept",
      expectedRevision: 0,
    });
    expect(() =>
      manager.review(project.id, {
        candidateId: due!.id,
        action: "accept",
        expectedRevision: 0,
      }),
    ).toThrow(/revision changed/);
    expect(() =>
      manager.review(project.id, {
        candidateId: owner!.id,
        action: "reject",
        expectedRevision: 1,
      }),
    ).toThrow(/not pending/);
    const other = store.create("Atlas Plus");
    expect(() =>
      manager.review(other.id, {
        candidateId: due!.id,
        action: "accept",
        expectedRevision: 0,
      }),
    ).toThrow(/not pending/);
    expect(store.get(project.id).approved).toHaveLength(1);
    expect(store.get(other.id).approved).toEqual([]);
  });

  it("withholds disputed current fields until review resolves the conflict", async () => {
    const answer = vi.fn<Model["answer"]>(async (input) => ({
      factIds: input.approved.map((fact) => fact.id),
      questions: [],
    }));
    const { manager, store, project } = await setup({
      model: model({ answer }),
    });
    await settled(store, manager.submit(project.id, note(ownerQuote)).id);
    manager.review(project.id, {
      candidateId: store.get(project.id).candidates[0]!.id,
      action: "accept",
      expectedRevision: 0,
    });
    const changed = 'Task "Cache" has owner "Zoe" effective 2026-10-06.';
    await settled(
      store,
      manager.submit(project.id, note(changed, "meeting-2")).id,
    );
    const candidate = store.get(project.id).candidates[1]!;
    expect(candidate.conflict).toBe(true);
    const disputed = await settled(
      store,
      manager.ask(project.id, { question: "Who owns Cache now?" }).id,
    );
    expect(answer.mock.calls.at(-1)?.[0].approved).toEqual([]);
    expect(disputed.output).toMatchObject({
      claims: [],
      status: "clarification",
    });
    expect((disputed.output as Answer).text).toContain("Conflicting fields");
    manager.review(project.id, {
      candidateId: candidate.id,
      action: "reject",
      expectedRevision: 1,
    });
    const resolved = await settled(
      store,
      manager.ask(project.id, { question: "Who owns Cache?" }).id,
    );
    expect(resolved.output).toMatchObject({
      claims: [expect.objectContaining({ value: "Ava" })],
    });
  });

  it("marks conflicting pending peers before any state is approved and clears the surviving peer after rejection", async () => {
    const { manager, store, project } = await setup();
    const conflictQuote = 'Task "Cache" has owner "Zoe" effective 2026-10-05.';
    await settled(
      store,
      manager.submit(project.id, note(`${ownerQuote}\n${conflictQuote}`)).id,
    );
    const candidates = store.get(project.id).candidates;
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.conflict)).toEqual([
      true,
      true,
    ]);
    const reviewed = manager.review(project.id, {
      candidateId: candidates[1]!.id,
      action: "reject",
      expectedRevision: 0,
    });
    expect(reviewed.candidates[0]?.conflict).toBe(false);
    expect(reviewed.approved).toEqual([]);
    expect(reviewed.revision).toBe(0);
  });

  it("approves stale facts as history without regressing current state", async () => {
    const { manager, store, project } = await setup();
    await settled(store, manager.submit(project.id, note(ownerQuote)).id);
    manager.review(project.id, {
      candidateId: store.get(project.id).candidates[0]!.id,
      action: "accept",
      expectedRevision: 0,
    });
    await settled(
      store,
      manager.submit(
        project.id,
        note(
          'Task "Cache" has owner "Old owner" effective 2026-09-01.',
          "historic-note",
        ),
      ).id,
    );
    const old = store.get(project.id).candidates[1]!;
    expect(old).toMatchObject({ historical: true, conflict: false });
    const reviewed = manager.review(project.id, {
      candidateId: old.id,
      action: "accept",
      expectedRevision: 1,
    });
    expect(reviewed.approved[0]?.value).toBe("Ava");
    expect(reviewed.history.map((fact) => fact.value)).toEqual([
      "Ava",
      "Old owner",
    ]);
    expect(reviewed.revision).toBe(2);
  });

  it("returns the original run on duplicate submissions and rejects source-version content conflicts", async () => {
    const worker = new FixtureWorker();
    const ingest = vi.spyOn(worker, "ingest");
    const { manager, store, project } = await setup({ worker });
    const original = manager.submit(project.id, note());
    await settled(store, original.id);
    expect(manager.submit(project.id, note()).id).toBe(original.id);
    expect(() => manager.submit(project.id, note("Changed bytes"))).toThrow(
      /different content/,
    );
    expect(store.get(project.id).notes).toHaveLength(1);
    expect(store.get(project.id).candidates).toHaveLength(2);
    expect(ingest).toHaveBeenCalledOnce();
  });

  it("retries missing indexing with the same intake identity and preserves accepted candidates", async () => {
    const worker = new FixtureWorker();
    const original = worker.ingest.bind(worker);
    let missing = true;
    const calls: Array<Parameters<Worker["ingest"]>[0]> = [];
    worker.ingest = async (input) => {
      calls.push(input);
      const receipt = await original(input);
      return { ...receipt, indexStatus: missing ? "missing" : "ready" };
    };
    const { manager, store, project } = await setup({ worker });
    const first = await settled(
      store,
      manager.submit(project.id, note(ownerQuote)).id,
    );
    expect(first.status).toBe("partial");
    const state = store.get(project.id);
    manager.review(project.id, {
      candidateId: state.candidates[0]!.id,
      action: "accept",
      expectedRevision: 0,
    });
    missing = false;
    const retry = await settled(
      store,
      manager.retry(project.id, state.notes[0]!.id).id,
    );
    expect(retry.status).toBe("success");
    expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
    expect(store.get(project.id).candidates).toHaveLength(1);
    expect(store.get(project.id).approved).toHaveLength(1);
    expect(store.get(project.id).notes[0]?.indexStatus).toBe("ready");
  });

  it("persists intake errors and retries after restart without creating a second note", async () => {
    const worker = new FixtureWorker();
    worker.failNext("meeting-1");
    const { manager, store, project, filename } = await setup({ worker });
    const original = await settled(
      store,
      manager.submit(project.id, note(ownerQuote)).id,
    );
    expect(original.status).toBe("error");
    const failed = store.get(project.id).notes[0]!;
    expect(failed.status).toBe("error");
    expect(original.spans.at(-1)).toMatchObject({
      name: "intake_error",
      status: "failed",
    });
    await manager.close();
    store.close();
    const restartedStore = new Store(filename);
    stores.push(restartedStore);
    const restarted = new Manager(restartedStore, worker, model());
    managers.push(restarted);
    const retry = await settled(
      restartedStore,
      restarted.retry(project.id, failed.id).id,
    );
    expect(retry.status).toBe("success");
    expect(restartedStore.getRun(original.id).status).toBe("error");
    expect(restartedStore.get(project.id).notes.map((item) => item.id)).toEqual(
      [failed.id],
    );
  });

  it("fails extraction atomically for malformed facts and quotes that do not occur in the snapshot", async () => {
    const extract: Model["extract"] = async () => [
      {
        entity: "Cache",
        field: "owner",
        value: "Ava",
        quote: ownerQuote,
        effectiveDate: "2026-10-05",
      },
      {
        entity: "Cache",
        field: "owner",
        value: "Invented",
        quote: "Never present",
        effectiveDate: "2026-10-05",
      },
    ];
    const { manager, store, project } = await setup({
      model: model({ extract }),
    });
    const run = await settled(
      store,
      manager.submit(project.id, note(ownerQuote)).id,
    );
    expect(run).toMatchObject({
      status: "error",
      error: "Extracted fact has no exact supporting passage",
    });
    expect(store.get(project.id).candidates).toEqual([]);
    expect(store.get(project.id).approved).toEqual([]);
  });

  it.each([
    {
      field: "due_date" as const,
      value: "2026-02-30",
      error: "valid ISO date",
    },
    {
      field: "status" as const,
      value: "probably finished",
      error: "Unsupported task status",
    },
  ])(
    "keeps invalid $field values out of the review queue",
    async ({ field, value, error }) => {
      const extract: Model["extract"] = async () => [
        {
          entity: "Cache",
          field,
          value,
          quote: ownerQuote,
          effectiveDate: "2026-10-05",
        },
      ];
      const { manager, store, project } = await setup({
        model: model({ extract }),
      });
      const run = await settled(
        store,
        manager.submit(project.id, note(ownerQuote)).id,
      );
      expect(run.status).toBe("error");
      expect(run.error).toContain(error);
      expect(store.get(project.id).candidates).toEqual([]);
    },
  );

  it("does not call extraction when the worker falsely confirms a different source version", async () => {
    const worker = new FixtureWorker();
    const original = worker.ingest.bind(worker);
    worker.ingest = async (input) => ({
      ...(await original(input)),
      sourceVersion: "wrong-version",
    });
    const extract = vi.fn<Model["extract"]>(async () => []);
    const { manager, store, project } = await setup({
      worker,
      model: model({ extract }),
    });
    const run = await settled(store, manager.submit(project.id, note()).id);
    expect(run).toMatchObject({
      status: "error",
      error: "Classifier did not confirm this exact source version",
    });
    expect(extract).not.toHaveBeenCalled();
    expect(store.get(project.id).notes[0]).toMatchObject({
      status: "error",
      documentRef: null,
    });
  });

  it("rejects invented fact IDs from a custom model and retains the failed conversation", async () => {
    const { manager, store, project } = await setup({
      model: model({
        answer: async () => ({ factIds: ["invented"], questions: [] }),
      }),
    });
    const run = await settled(
      store,
      manager.ask(project.id, { question: "Who owns Cache?" }).id,
    );
    expect(run).toMatchObject({
      status: "error",
      error: "Answer referenced an unapproved or disputed fact",
    });
    expect(store.get(project.id).conversations[0]?.messages[0]).toMatchObject({
      runId: run.id,
      answer: null,
    });
  });

  it("keeps conversations and citations project-scoped and caps question turns at six", async () => {
    const answer = vi.fn<Model["answer"]>(async (input) => ({
      factIds: input.approved.map((fact) => fact.id),
      questions: [],
    }));
    const { manager, store, project } = await setup({
      model: model({ answer }),
    });
    await settled(store, manager.submit(project.id, note(ownerQuote)).id);
    const state = store.get(project.id);
    manager.review(project.id, {
      candidateId: state.candidates[0]!.id,
      action: "accept",
      expectedRevision: 0,
    });
    await settled(
      store,
      manager.ask(project.id, { question: "Who owns Cache?", maxTurns: 6 }).id,
    );
    expect(answer.mock.calls[0]?.[0].maxTurns).toBe(6);
    const conversationId = store.get(project.id).conversations[0]!.id;
    const other = store.create("Atlas Plus");
    expect(() =>
      manager.ask(other.id, { question: "Who owns Cache?", conversationId }),
    ).toThrow(/does not belong/);
    await expect(
      manager.read(other.id, state.notes[0]!.documentRef!),
    ).rejects.toThrow(/does not belong/);
    expect(() =>
      manager.ask(project.id, { question: "Question", maxTurns: 7 }),
    ).toThrow(/one and six/);
    expect(() =>
      manager.ask(project.id, { question: "Question", maxTurns: 0 }),
    ).toThrow(/one and six/);
  });

  it("shows coverage limitations even when an approved fact can be answered", async () => {
    const worker = new FixtureWorker();
    const { manager, store, project } = await setup({
      worker,
      model: model({
        answer: async (input) => {
          await input.search(input.question);
          return {
            factIds: input.approved.map((fact) => fact.id),
            questions: [],
          };
        },
      }),
    });
    await settled(store, manager.submit(project.id, note(ownerQuote)).id);
    const state = store.get(project.id);
    manager.review(project.id, {
      candidateId: state.candidates[0]!.id,
      action: "accept",
      expectedRevision: 0,
    });
    worker.markMissing(state.notes[0]!.documentRef!);
    const result = await settled(
      store,
      manager.ask(project.id, { question: "Who owns Cache?" }).id,
    );
    expect(result.output).toMatchObject({
      status: "partial",
      missingEmbeddings: 1,
      claims: [expect.objectContaining({ value: "Ava" })],
    });
    expect((result.output as Answer).text).toContain("coverage is incomplete");
  });

  it("fails closed on incorrect library identity and preserves source information", async () => {
    const { manager, store, project } = await setup({
      libraryRoot: "/expected/project-evidence",
    });
    const run = await settled(store, manager.submit(project.id, note()).id);
    expect(run).toMatchObject({
      status: "error",
      error:
        "Classifier library root differs from the configured project library",
    });
    expect(store.get(project.id).notes[0]?.markdown).toBe(note().markdown);
    expect(store.get(project.id).candidates).toEqual([]);
  });

  it("limits all search turns to five raw passages and exposes only approved supporting spans", async () => {
    const worker = new FixtureWorker();
    const originalSearch = worker.search.bind(worker);
    const budgets: number[] = [];
    worker.search = async (projectId, question, topK = 5) => {
      budgets.push(topK);
      const result = await originalSearch(projectId, question, topK);
      return {
        ...result,
        passages: Array.from(
          { length: Math.min(2, topK) },
          () => result.passages[0]!,
        ),
      };
    };
    const answer: Model["answer"] = async (input) => {
      for (let turn = 0; turn < 6; turn++) {
        const result = await input.search("Cache");
        expect(result.passages.length).toBeLessThanOrEqual(1);
        for (const passage of result.passages)
          expect(passage.quote).toBe(ownerQuote);
      }
      const approvedOnly = await input.read(
        input.approved[0]!.evidence.documentRef,
      );
      expect(approvedOnly.markdown).toBe(ownerQuote);
      expect(approvedOnly.markdown).not.toContain(dueQuote);
      return { factIds: input.approved.map((fact) => fact.id), questions: [] };
    };
    const { manager, store, project } = await setup({
      worker,
      model: model({ answer }),
    });
    await settled(store, manager.submit(project.id, note()).id);
    manager.review(project.id, {
      candidateId: store.get(project.id).candidates[0]!.id,
      action: "accept",
      expectedRevision: 0,
    });
    const run = await settled(
      store,
      manager.ask(project.id, { question: "Who owns Cache?" }).id,
    );
    expect(run.status).toBe("partial");
    expect(budgets).toEqual([5, 3, 1]);
    expect(run.output).toMatchObject({
      claims: [expect.objectContaining({ value: "Ava" })],
      pendingReview: 1,
    });
  });

  it("rejects a changed source date and a corrupt citation snapshot", async () => {
    const worker = new FixtureWorker();
    const { manager, store, project } = await setup({ worker });
    await settled(store, manager.submit(project.id, note()).id);
    expect(() =>
      manager.submit(project.id, { ...note(), sourceDate: "2026-10-06" }),
    ).toThrow(/different/);
    const documentRef = store.get(project.id).notes[0]!.documentRef!;
    const original = worker.read.bind(worker);
    worker.read = async (projectId, ref) => ({
      ...(await original(projectId, ref)),
      markdown: "Tampered evidence",
    });
    await expect(manager.read(project.id, documentRef)).rejects.toThrow(
      /integrity/i,
    );
  });

  it.each(["sourceId", "sourceVersion", "sourceDate"] as const)(
    "rejects intake snapshot %s mismatches before extraction",
    async (field) => {
      const worker = new FixtureWorker();
      const original = worker.read.bind(worker);
      worker.read = async (projectId, documentRef) => ({
        ...(await original(projectId, documentRef)),
        [field]: field === "sourceDate" ? "2026-10-06" : "wrong-source",
      });
      const extract = vi.fn<Model["extract"]>(async () => []);
      const { manager, store, project } = await setup({
        worker,
        model: model({ extract }),
      });
      const run = await settled(store, manager.submit(project.id, note()).id);
      expect(run).toMatchObject({
        status: "error",
        error: "Snapshot integrity check failed",
      });
      expect(extract).not.toHaveBeenCalled();
      expect(store.get(project.id).candidates).toEqual([]);
      expect(store.get(project.id).notes[0]).toMatchObject({ status: "error" });
    },
  );

  it.each(["sourceId", "sourceVersion", "sourceDate"] as const)(
    "rejects public citation reads after snapshot %s changes",
    async (field) => {
      const worker = new FixtureWorker();
      const { manager, store, project } = await setup({ worker });
      await settled(store, manager.submit(project.id, note()).id);
      const documentRef = store.get(project.id).notes[0]!.documentRef!;
      const original = worker.read.bind(worker);
      worker.read = async (projectId, ref) => ({
        ...(await original(projectId, ref)),
        [field]: field === "sourceDate" ? "2026-10-06" : "wrong-source",
      });
      await expect(manager.read(project.id, documentRef)).rejects.toThrow(
        "Snapshot integrity check failed",
      );
    },
  );
});
