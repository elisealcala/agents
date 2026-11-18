import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
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
import { GitHubTransportError } from "../integrations/github/client.ts";
import type {
  ProjectCreateReceipt,
  ProjectCreateReceiptStore,
} from "../integrations/github/project-create.ts";
import type { ProjectField } from "../integrations/github/projects.ts";
import { ConnectionStore } from "../storage/connection-store.ts";
import { ProjectBindingStore } from "../storage/project-bindings.ts";
import { createNodeSqlDriver } from "../storage/sql-driver.ts";
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
  it("routes local projects through the service while preserving transport validation and errors", async () => {
    const ctx = await context();
    const create = vi.spyOn(ctx.manager.projects, "create");
    const list = vi.spyOn(ctx.manager.projects, "list");
    const get = vi.spyOn(ctx.manager.projects, "get");

    await expect(
      ctx.caller.projects.create({ name: "a".repeat(201) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
    expect(ctx.store.list()).toEqual([]);

    const project = await ctx.caller.projects.create({ name: "  Atlas  " });
    expect(create).toHaveBeenCalledExactlyOnceWith("Atlas");
    expect(await ctx.caller.projects.list()).toEqual([project]);
    expect(list).toHaveBeenCalledOnce();
    expect(await ctx.caller.projects.get({ projectId: project.id })).toEqual(
      project,
    );
    expect(get).toHaveBeenCalledExactlyOnceWith(project.id);

    await expect(
      ctx.caller.projects.get({ projectId: "invalid" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(get).toHaveBeenCalledOnce();
    await expect(
      ctx.caller.projects.get({ projectId: randomUUID() }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unknown project",
    });
  });

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

describe("github connections router", () => {
  const key = new Uint8Array(32).fill(7);
  const secret = "ghs_super_secret_token";
  const rotated = "ghs_rotated_secret_token";
  const app = {
    id: "app-1",
    kind: "app" as const,
    externalRef: "install-1",
    credential: secret,
    capabilities: { repositoryRead: true },
  };

  async function connected(owner = true) {
    const ctx = await context();
    const file = path.join(ctx.root, "connections.sqlite");
    const open = () => {
      const db = new DatabaseSync(file);
      return { db, store: new ConnectionStore(createNodeSqlDriver(db), key) };
    };
    const callerFor = (store: ConnectionStore) =>
      appRouter.createCaller({
        manager: ctx.manager,
        model: "fixture",
        owner,
        connections: store,
      });
    const first = open();
    return { first, open, callerFor, caller: callerFor(first.store) };
  }

  it("rejects unauthenticated reads and writes", async () => {
    const { caller, first } = await connected(false);
    await expect(caller.connections.list()).rejects.toThrow("UNAUTHORIZED");
    await expect(caller.connections.connect(app)).rejects.toThrow(
      "UNAUTHORIZED",
    );
    expect(first.store.list()).toEqual([]);
    first.db.close();
  });

  it("keeps App status independent, rejects duplicates and never leaks secrets", async () => {
    const { caller, first } = await connected();
    const projects = await caller.connections.connect({
      id: "projects-1",
      kind: "projects",
      externalRef: "owner-1",
      credential: "ghu_projects_secret",
    });
    const repo = await caller.connections.connect(app);
    const degraded = await caller.connections.updateState({
      id: "projects-1",
      expectedRevision: projects.revision,
      status: "degraded",
      capabilities: { projectsRead: false },
    });
    expect(degraded.status).toBe("degraded");
    expect(await caller.connections.get({ id: "app-1" })).toEqual(repo);
    const all = JSON.stringify([
      await caller.connections.list(),
      await caller.connections.receipts({ id: "app-1" }),
    ]);
    expect(all).not.toContain(secret);
    expect(all).not.toContain("ghu_projects_secret");
    await expect(caller.connections.connect(app)).rejects.toThrow(
      "Connection exists",
    );
    await expect(
      caller.connections.updateState({
        id: "app-1",
        expectedRevision: 0,
        status: "connected",
        capabilities: { projectWrites: true },
      }),
    ).rejects.toThrow("Capability is not available yet");
    first.db.close();
  });

  it("detects revision conflicts, revokes credentials and persists across restart", async () => {
    const { caller, first, open, callerFor } = await connected();
    await caller.connections.connect(app);
    const id = "app-1";
    await caller.connections.rotate({
      id,
      expectedRevision: 0,
      credential: rotated,
    });
    await expect(
      caller.connections.rotate({ id, expectedRevision: 0, credential: "x" }),
    ).rejects.toThrow("Revision conflict");
    expect(first.store.readCredential(id)).toBe(rotated);
    const gone = await caller.connections.disconnect({
      id,
      expectedRevision: 1,
    });
    expect(gone).toMatchObject({
      status: "disconnected",
      hasCredential: false,
    });
    expect(() => first.store.readCredential(id)).toThrow(
      "Credential unavailable",
    );
    first.db.close();
    const second = open();
    const again = callerFor(second.store);
    expect(await again.connections.get({ id })).toEqual(gone);
    const receipts = await again.connections.receipts({ id });
    expect(receipts.map((r) => r.action)).toEqual([
      "created",
      "rotated",
      "disconnected",
    ]);
    await expect(again.connections.get({ id: "missing" })).rejects.toThrow(
      "Unknown connection",
    );
    second.db.close();
  });
});

describe("github projects router", () => {
  const key = new Uint8Array(32).fill(9);
  const token = "ghu_projects_token_secret";
  const repositoryId = 1355217430;
  const statusField: ProjectField = {
    id: "F_status",
    name: "Status",
    type: "single_select",
    options: [
      { id: "O_todo", name: "Todo" },
      { id: "O_done", name: "Done" },
    ],
  };

  function receiptStore(db: DatabaseSync): ProjectCreateReceiptStore {
    db.exec(
      "CREATE TABLE IF NOT EXISTS t_receipts(id TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
    return {
      get: (operationId) => {
        const row = db
          .prepare("SELECT body FROM t_receipts WHERE id=?")
          .get(operationId) as { body: string } | undefined;
        return row ? (JSON.parse(row.body) as ProjectCreateReceipt) : undefined;
      },
      save: (receipt) => {
        db.prepare("INSERT OR REPLACE INTO t_receipts VALUES (?, ?)").run(
          receipt.operationId,
          JSON.stringify(receipt),
        );
      },
      hasBinding: (id) =>
        new ProjectBindingStore(createNodeSqlDriver(db)).get(id) !== undefined,
    };
  }

  async function projectsContext(options: { connect?: boolean } = {}) {
    const ctx = await context();
    const file = path.join(ctx.root, "projects.sqlite");
    const remote = {
      projects: [
        { id: "P_1", number: 1, title: "Existing", ownerLogin: "elisealcala" },
      ],
      fields: [statusField] as ProjectField[],
      failure: undefined as GitHubTransportError | undefined,
      createFailure: undefined as Error | undefined,
      creates: 0,
      tokens: [] as string[],
    };
    const transport = {
      listOwnerProjects: async (t: string) => {
        remote.tokens.push(t);
        if (remote.failure) throw remote.failure;
        return structuredClone(remote.projects);
      },
      listProjectFields: async () => structuredClone(remote.fields),
      createProject: async (_t: string, title: string) => {
        remote.creates += 1;
        if (remote.createFailure) throw remote.createFailure;
        const project = {
          id: `P_new${remote.creates}`,
          number: 10 + remote.creates,
          title,
          ownerLogin: "elisealcala",
        };
        remote.projects.push(project);
        return project;
      },
    };
    const open = () => {
      const db = new DatabaseSync(file);
      const connections = new ConnectionStore(createNodeSqlDriver(db), key);
      return {
        db,
        connections,
        caller: appRouter.createCaller({
          manager: ctx.manager,
          model: "fixture",
          owner: true,
          connections,
          projectsTransport: transport,
          projectBindings: new ProjectBindingStore(createNodeSqlDriver(db)),
          projectCreateReceipts: receiptStore(db),
        }),
      };
    };
    const first = open();
    if (options.connect !== false)
      first.connections.create({
        id: "projects-1",
        kind: "projects",
        externalRef: "owner-1",
        credential: token,
        capabilities: { projectsRead: true },
      });
    await ctx.caller.delivery.bindKnownRepository({ name: "agents" });
    return { ...ctx, remote, open, first };
  }

  it("discovers projects read-only with the Projects credential", async () => {
    const p = await projectsContext();
    const result = await p.first.caller.githubProjects.discover();
    expect(result).toEqual({
      ok: true,
      projects: [{ project: p.remote.projects[0], fields: [statusField] }],
    });
    expect(p.remote.tokens).toEqual([token]);
    expect(p.remote.creates).toBe(0);
    p.first.db.close();
  });

  it("rejects non-owners and maps denied/expired/unavailable safely", async () => {
    const p = await projectsContext();
    const anonymous = appRouter.createCaller({
      manager: p.manager,
      model: "fixture",
    });
    await expect(anonymous.githubProjects.discover()).rejects.toThrow(
      "UNAUTHORIZED",
    );
    for (const [kind, code] of [
      ["forbidden", "projects_access_denied"],
      ["unauthorized", "projects_credentials_expired"],
      ["unavailable", "unavailable"],
    ] as const) {
      p.remote.failure = new GitHubTransportError(kind, `boom ${token}`);
      const result = await p.first.caller.githubProjects.discover();
      expect(result).toEqual({ ok: false, code });
      expect(JSON.stringify(result)).not.toContain(token);
    }
    p.first.db.close();
    const none = await projectsContext({ connect: false });
    expect(await none.first.caller.githubProjects.discover()).toEqual({
      ok: false,
      code: "projects_access_denied",
    });
    none.first.db.close();
  });

  it("rejects unknown and mismatched repository identities", async () => {
    const p = await projectsContext();
    const { caller } = p.first;
    await expect(
      caller.githubProjects.adopt({ repositoryId: 42, projectId: "P_1" }),
    ).rejects.toThrow("Unknown repository");
    await expect(
      caller.githubProjects.adopt({
        repositoryId,
        name: "chore-design",
        projectId: "P_1",
      }),
    ).rejects.toThrow("Repository identity mismatch");
    await expect(
      caller.githubProjects.create({
        repositoryId: 42,
        operationId: "op",
        title: "X",
      }),
    ).rejects.toThrow("Unknown repository");
    await expect(
      caller.githubProjects.binding({ repositoryId: 42 }),
    ).rejects.toThrow("Unknown repository");
    expect(p.remote.tokens).toEqual([]);
    p.first.db.close();
  });

  it("adopts read-only, is idempotent, persists across restart and rejects conflicts", async () => {
    const p = await projectsContext();
    const { caller } = p.first;
    const adopted = await caller.githubProjects.adopt({
      repositoryId,
      projectId: "P_1",
    });
    expect(adopted).toEqual({
      ok: true,
      binding: {
        repositoryId,
        projectId: "P_1",
        projectNumber: 1,
        mapping: {
          statusFieldId: "F_status",
          statusOptionIds: ["O_todo", "O_done"],
        },
      },
    });
    expect(
      await caller.githubProjects.adopt({ repositoryId, projectId: "P_1" }),
    ).toEqual(adopted);
    expect(p.remote.creates).toBe(0);
    expect(
      await caller.githubProjects.adopt({ repositoryId, projectId: "P_2" }),
    ).toEqual({ ok: false, code: "already_bound" });
    p.first.db.close();
    const second = p.open();
    expect(
      await second.caller.githubProjects.binding({ repositoryId }),
    ).toEqual({ ok: true, binding: adopted.ok ? adopted.binding : null });
    second.db.close();
  });

  it("returns mapping candidates instead of guessing a field", async () => {
    const p = await projectsContext();
    const { caller } = p.first;
    p.remote.fields = [
      { ...statusField, id: "F_a", name: "Stage" },
      { ...statusField, id: "F_b", name: "Phase" },
    ];
    expect(
      await caller.githubProjects.adopt({ repositoryId, projectId: "P_1" }),
    ).toEqual({
      ok: false,
      code: "mapping_required",
      candidates: ["F_a", "F_b"],
    });
    expect(
      await caller.githubProjects.adopt({
        repositoryId,
        projectId: "P_1",
        statusFieldId: "F_missing",
      }),
    ).toMatchObject({ ok: false, code: "mapping_invalid" });
    expect(await caller.githubProjects.binding({ repositoryId })).toEqual({
      ok: true,
      binding: null,
    });
    const chosen = await caller.githubProjects.adopt({
      repositoryId,
      projectId: "P_1",
      statusFieldId: "F_b",
    });
    expect(chosen).toMatchObject({
      ok: true,
      binding: { mapping: { statusFieldId: "F_b" } },
    });
    p.first.db.close();
  });

  it("creates once, rejects duplicate titles and bound repositories, reconciles unknown outcomes", async () => {
    const p = await projectsContext();
    const { caller } = p.first;
    expect(
      await caller.githubProjects.create({
        repositoryId,
        operationId: "op-dup",
        title: "Existing",
      }),
    ).toEqual({ ok: false, code: "title_exists", candidates: undefined });
    // Unknown outcome: GitHub created the board but the response was lost.
    p.remote.createFailure = new GitHubTransportError("unavailable", token);
    const lost = await caller.githubProjects.create({
      repositoryId,
      operationId: "op-1",
      title: "Board",
    });
    expect(lost).toMatchObject({ ok: false, code: "unavailable" });
    expect(JSON.stringify(lost)).not.toContain(token);
    p.remote.createFailure = undefined;
    p.remote.projects.push({
      id: "P_lost",
      number: 5,
      title: "Board",
      ownerLogin: "elisealcala",
    });
    p.first.db.close();
    const second = p.open();
    const retried = await second.caller.githubProjects.create({
      repositoryId,
      operationId: "op-1",
      title: "Board",
    });
    expect(retried).toEqual({
      ok: true,
      projectId: "P_lost",
      projectNumber: 5,
      created: false,
    });
    expect(p.remote.creates).toBe(1);
    await expect(
      second.caller.githubProjects.create({
        repositoryId,
        operationId: "op-1",
        title: "Other",
      }),
    ).rejects.toThrow("Operation belongs to a different request");
    // Creation did not bind; adoption is a separate step.
    expect(
      await second.caller.githubProjects.binding({ repositoryId }),
    ).toEqual({ ok: true, binding: null });
    await second.caller.githubProjects.adopt({
      repositoryId,
      projectId: "P_lost",
    });
    expect(
      await second.caller.githubProjects.create({
        repositoryId,
        operationId: "op-2",
        title: "Another",
      }),
    ).toMatchObject({ ok: false, code: "already_bound" });
    second.db.close();
  });

  it("reports ambiguous creates", async () => {
    const p = await projectsContext();
    p.remote.createFailure = new GitHubTransportError("unavailable");
    await p.first.caller.githubProjects.create({
      repositoryId,
      operationId: "op-amb",
      title: "Twin",
    });
    for (const id of ["P_a", "P_b"])
      p.remote.projects.push({
        id,
        number: 7,
        title: "Twin",
        ownerLogin: "elisealcala",
      });
    expect(
      await p.first.caller.githubProjects.create({
        repositoryId,
        operationId: "op-amb",
        title: "Twin",
      }),
    ).toEqual({
      ok: false,
      code: "ambiguous_create",
      candidates: ["P_a", "P_b"],
    });
    p.first.db.close();
  });
});
