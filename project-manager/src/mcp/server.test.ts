import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FixtureWorker } from "../../evals/fixture-worker.ts";
import type {
  Candidate,
  Model,
  Project,
  Run,
  Snapshot,
} from "../application/contracts.ts";
import { Manager } from "../application/manager.ts";
import { appRouter } from "../server/router.ts";
import { Store } from "../storage/store.ts";
import { createManagerClient, createManagerServer } from "./server.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function closeHTTP(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

async function context() {
  const root = await mkdtemp(path.join(os.tmpdir(), "manager-mcp-"));
  const store = new Store(path.join(root, "manager.sqlite"));
  const worker = new FixtureWorker();
  const ingest = vi.spyOn(worker, "ingest");
  const read = vi.spyOn(worker, "read");
  const extract = vi.fn<Model["extract"]>(async (snapshot) => [
    {
      entity: "Release task",
      field: "owner",
      value: "Ada",
      quote: snapshot.markdown,
      effectiveDate: snapshot.sourceDate,
    },
  ]);
  const answer = vi.fn<Model["answer"]>(async (input) => ({
    factIds: input.approved.map((fact) => fact.id),
    questions: input.approved.length ? [] : ["Who owns Release task?"],
  }));
  const model: Model = { name: "fixture", extract, answer };
  const manager = new Manager(store, worker, model, {
    libraryRoot: worker.root,
  });
  const caller = appRouter.createCaller({ manager, model: model.name });
  const http = createHTTPServer({
    router: appRouter,
    createContext: () => ({ manager, model: model.name }),
  });
  cleanup.push(async () => {
    await closeHTTP(http);
    await manager.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No HTTP port");
  const url = `http://127.0.0.1:${address.port}`;
  const server = createManagerServer(createManagerClient(url));
  const client = new Client({ name: "manager-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    root,
    store,
    worker,
    ingest,
    read,
    extract,
    answer,
    manager,
    caller,
    http,
    url,
    client,
  };
}

type Context = Awaited<ReturnType<typeof context>>;
const envelopeSchema = z.object({
  status: z.enum(["ok", "error"]),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

async function call<T>(
  ctx: Context,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await ctx.client.callTool({ name, arguments: args });
  const diagnostic = `${name}: ${JSON.stringify(result)}`;
  expect(result.isError, diagnostic).toBe(false);
  const envelope = envelopeSchema.parse(result.structuredContent);
  expect(envelope.status, diagnostic).toBe("ok");
  expect(result.content).toEqual([
    { type: "text", text: JSON.stringify(result.structuredContent) },
  ]);
  return envelope.data as T;
}

async function startRun(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
  terminalStatus: Exclude<Run["status"], "running"> = "success",
) {
  const result = await ctx.client.callTool({ name, arguments: args });
  const diagnostic = `${name}: ${JSON.stringify(result)}`;
  const envelope = envelopeSchema.parse(result.structuredContent);
  const data = z
    .object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      status: z.enum(["running", "success", "partial", "error"]),
      spans: z.array(z.unknown()),
    })
    .passthrough()
    .parse(envelope.data);
  expect(data.projectId, diagnostic).toBe(args.projectId);
  expect(["running", terminalStatus], diagnostic).toContain(data.status);
  const failed = data.status === "error" || data.status === "partial";
  expect(result.isError, diagnostic).toBe(failed);
  expect(envelope.status, diagnostic).toBe(failed ? "error" : "ok");
  expect(result.content, diagnostic).toEqual([
    { type: "text", text: JSON.stringify(result.structuredContent) },
  ]);
  return envelope.data as Run;
}

async function error(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
  message?: string,
) {
  const result = await ctx.client.callTool({ name, arguments: args });
  expect(result.isError, `${name}: ${JSON.stringify(result)}`).toBe(true);
  if (message) expect(JSON.stringify(result)).toContain(message);
  return result;
}

async function completed(ctx: Context, projectId: string, runId: string) {
  await vi.waitFor(
    async () => {
      expect((await ctx.caller.runs.get({ projectId, runId })).status).not.toBe(
        "running",
      );
    },
    { timeout: 5000 },
  );
  return ctx.caller.runs.get({ projectId, runId });
}

const note = {
  sourceId: "standup",
  sourceVersion: "1",
  markdown: "Release task owner: Ada.",
  sourceDate: "2026-10-07",
};
async function submit(
  ctx: Context,
  projectId: string,
  terminalStatus: Exclude<Run["status"], "running"> = "success",
) {
  const started = await startRun(
    ctx,
    "submit_note",
    { projectId, ...note },
    terminalStatus,
  );
  const run = await completed(ctx, projectId, started.id);
  expect(run.status, JSON.stringify(run)).toBe(terminalStatus);
  return run;
}

describe("project-manager MCP bridge", () => {
  it("discovers all typed tools, review boundaries and operation annotations", async () => {
    const ctx = await context();
    expect(ctx.client.getInstructions()).toContain(
      "only explicit human review approves facts",
    );
    expect(ctx.client.getInstructions()).toContain(
      "Chat history is not automatically ingested",
    );
    const { tools } = await ctx.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "ask_project",
      "create_project",
      "get_project",
      "get_run",
      "list_projects",
      "list_reviews",
      "list_runs",
      "read_evidence",
      "resolve_review",
      "retry_note",
      "submit_note",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema).toMatchObject({
        type: "object",
        required: ["status"],
      });
      if (!["list_projects", "create_project"].includes(tool.name)) {
        expect(tool.inputSchema.required).toContain("projectId");
        expect(tool.inputSchema.properties?.projectId).toMatchObject({
          type: "string",
          format: "uuid",
        });
      }
    }
    expect(
      tools.find((tool) => tool.name === "get_project")?.annotations,
    ).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(
      tools.find((tool) => tool.name === "submit_note")?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(
      tools.find((tool) => tool.name === "resolve_review")?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("shares projects with direct callers and reports intake as running until extraction finishes", async () => {
    const ctx = await context();
    const direct = await ctx.caller.projects.create({ name: "Agents" });
    expect(await call<Project[]>(ctx, "list_projects")).toEqual([direct]);
    const created = await call<Project>(ctx, "create_project", {
      name: "  Agents Mobile  ",
    });
    expect(created.name).toBe("Agents Mobile");
    expect(await ctx.caller.projects.get({ projectId: created.id })).toEqual(
      created,
    );
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.extract.mockImplementationOnce(async (snapshot) => {
      await gate;
      return [
        {
          entity: "Release task",
          field: "owner",
          value: "Ada",
          quote: snapshot.markdown,
          effectiveDate: snapshot.sourceDate,
        },
      ];
    });
    try {
      const started = await call<Run>(ctx, "submit_note", {
        projectId: direct.id,
        ...note,
      });
      expect(started).toMatchObject({
        status: "running",
        output: null,
        endedAt: null,
      });
      const running = await call<Run>(ctx, "get_run", {
        projectId: direct.id,
        runId: started.id,
      });
      expect(running.status).toBe("running");
      expect(
        (await call<Project>(ctx, "get_project", { projectId: direct.id }))
          .approved,
      ).toEqual([]);
      release();
      await completed(ctx, direct.id, started.id);
      const finished = await call<Run>(ctx, "get_run", {
        projectId: direct.id,
        runId: started.id,
      });
      expect(finished.status).toBe("success");
      expect(finished.spans.map((span) => span.name)).toEqual([
        "registration",
        "extraction",
        "reconciliation",
      ]);
      expect(
        await call<Run[]>(ctx, "list_runs", { projectId: direct.id }),
      ).toEqual([finished]);
    } finally {
      release();
    }
  });

  it("withholds pending facts and answers follow-ups with explicit human correction provenance", async () => {
    const ctx = await context();
    const project = await call<Project>(ctx, "create_project", {
      name: "Agents",
    });
    await submit(ctx, project.id);
    const [candidate] = await call<Candidate[]>(ctx, "list_reviews", {
      projectId: project.id,
    });
    const question = await startRun(
      ctx,
      "ask_project",
      {
        projectId: project.id,
        question: "Who owns Release task?",
      },
      "partial",
    );
    const pending = await completed(ctx, project.id, question.id);
    expect(pending.output).toMatchObject({
      claims: [],
      pendingReview: 1,
      status: "clarification",
    });
    expect(ctx.answer.mock.calls[0]?.[0].approved).toEqual([]);
    const edited = await call<Project>(ctx, "resolve_review", {
      projectId: project.id,
      candidateId: candidate!.id,
      action: "edit",
      expectedRevision: 0,
      value: "Grace",
      effectiveDate: "2026-10-08",
    });
    expect(edited.reviews[0]).toMatchObject({
      original: { value: "Ada", evidence: { kind: "document" } },
      correction: { value: "Grace", effectiveDate: "2026-10-08" },
    });
    expect(edited.approved[0]).toMatchObject({
      value: "Grace",
      evidence: { kind: "human", quote: "Grace" },
    });
    expect(await ctx.caller.projects.get({ projectId: project.id })).toEqual(
      edited,
    );
    await error(
      ctx,
      "resolve_review",
      {
        projectId: project.id,
        candidateId: candidate!.id,
        action: "reject",
        expectedRevision: 0,
      },
      "Project revision changed",
    );
    const calls = ctx.read.mock.calls.length;
    const confirmation = await call<Snapshot>(ctx, "read_evidence", {
      projectId: project.id,
      documentRef: edited.approved[0]!.evidence.documentRef,
    });
    expect(confirmation.markdown).toBe("Grace");
    expect(ctx.read).toHaveBeenCalledTimes(calls);
    const original = await call<Snapshot>(ctx, "read_evidence", {
      projectId: project.id,
      documentRef: candidate!.evidence.documentRef,
    });
    expect(original.markdown).toBe(note.markdown);
    const followup = await call<Run>(ctx, "ask_project", {
      projectId: project.id,
      conversationId: edited.conversations[0]!.id,
      question: "Who owns it now?",
    });
    await completed(ctx, project.id, followup.id);
    const final = await call<Run>(ctx, "get_run", {
      projectId: project.id,
      runId: followup.id,
    });
    expect(final.output).toMatchObject({
      status: "answered",
      pendingReview: 0,
      claims: [{ value: "Grace", evidence: { kind: "human", quote: "Grace" } }],
    });
    const saved = await ctx.caller.projects.get({ projectId: project.id });
    expect(saved.conversations).toHaveLength(1);
    expect(saved.conversations[0]?.messages).toHaveLength(2);
    expect(saved.revision).toBe(1);
    expect(
      await call<Candidate[]>(ctx, "list_reviews", { projectId: project.id }),
    ).toEqual([]);
  });

  it("rejects cross-project runs, citations, notes, reviews and conversation reuse", async () => {
    const ctx = await context();
    const atlas = await ctx.caller.projects.create({ name: "Atlas" });
    const mobile = await ctx.caller.projects.create({ name: "Atlas Mobile" });
    const run = await submit(ctx, atlas.id);
    const state = ctx.store.get(atlas.id);
    const candidate = state.candidates[0]!;
    const question = await startRun(
      ctx,
      "ask_project",
      {
        projectId: atlas.id,
        question: "Who owns Release task?",
      },
      "partial",
    );
    await completed(ctx, atlas.id, question.id);
    const conversationId = ctx.store.get(atlas.id).conversations[0]!.id;
    await error(
      ctx,
      "get_run",
      { projectId: mobile.id, runId: run.id },
      "Run does not belong",
    );
    await error(
      ctx,
      "read_evidence",
      { projectId: mobile.id, documentRef: candidate.evidence.documentRef },
      "Evidence does not belong",
    );
    await error(
      ctx,
      "retry_note",
      { projectId: mobile.id, noteId: state.notes[0]!.id },
      "Unknown note",
    );
    await error(
      ctx,
      "resolve_review",
      {
        projectId: mobile.id,
        candidateId: candidate.id,
        action: "accept",
        expectedRevision: 0,
      },
      "Candidate is not pending",
    );
    await error(
      ctx,
      "ask_project",
      { projectId: mobile.id, conversationId, question: "Who owns it?" },
      "Conversation does not belong",
    );
    expect(
      await call<Run[]>(ctx, "list_runs", { projectId: mobile.id }),
    ).toEqual([]);
    expect(
      (await call<Project>(ctx, "get_project", { projectId: mobile.id }))
        .approved,
    ).toEqual([]);
    expect(ctx.store.get(atlas.id).revision).toBe(0);
  });

  it("preserves duplicate-safe intake and retry identities with visible terminal failures", async () => {
    const ctx = await context();
    const project = await ctx.caller.projects.create({ name: "Agents" });
    ctx.worker.failNext(note.sourceId);
    const failed = await submit(ctx, project.id, "error");
    expect(failed.status).toBe("error");
    const failure = await error(
      ctx,
      "get_run",
      { projectId: project.id, runId: failed.id },
      "storage interruption",
    );
    expect(failure.structuredContent).toMatchObject({
      status: "error",
      data: { id: failed.id, status: "error" },
    });
    const noteId = ctx.store.get(project.id).notes[0]!.id;
    const retry = await call<Run>(ctx, "retry_note", {
      projectId: project.id,
      noteId,
    });
    expect(retry.id).not.toBe(failed.id);
    await completed(ctx, project.id, retry.id);
    const duplicate = await call<Run>(ctx, "submit_note", {
      projectId: project.id,
      ...note,
    });
    const healthyRetry = await call<Run>(ctx, "retry_note", {
      projectId: project.id,
      noteId,
    });
    expect(duplicate.id).toBe(retry.id);
    expect(healthyRetry.id).toBe(retry.id);
    expect(
      ctx.ingest.mock.calls.map(([input]) => input.idempotencyKey),
    ).toEqual([noteId, noteId]);
    expect(ctx.extract).toHaveBeenCalledOnce();
    expect(ctx.store.get(project.id).candidates).toHaveLength(1);
    await error(
      ctx,
      "submit_note",
      { projectId: project.id, ...note, markdown: "Changed bytes" },
      "different content",
    );
    expect(ctx.store.get(project.id).notes).toHaveLength(1);
    await error(ctx, "get_run", { projectId: project.id, runId: failed.id });
  });

  it("marks incomplete indexing as an MCP error while retaining inspectable facts and traces", async () => {
    const ctx = await context();
    ctx.ingest.mockImplementationOnce(async (input) => ({
      ...(await FixtureWorker.prototype.ingest.call(ctx.worker, input)),
      indexStatus: "missing",
    }));
    const project = await ctx.caller.projects.create({ name: "Agents" });
    const run = await submit(ctx, project.id, "partial");
    expect(run.status).toBe("partial");
    const result = await error(ctx, "get_run", {
      projectId: project.id,
      runId: run.id,
    });
    expect(result.structuredContent).toMatchObject({
      status: "error",
      data: { status: "partial", spans: expect.any(Array) },
    });
    expect(
      await call<Candidate[]>(ctx, "list_reviews", { projectId: project.id }),
    ).toHaveLength(1);
    expect(ctx.store.get(project.id).approved).toEqual([]);
  });

  it("validates inputs and surfaces an unavailable backend without fabricating results", async () => {
    const ctx = await context();
    const project = await ctx.caller.projects.create({ name: "Agents" });
    await error(
      ctx,
      "get_project",
      { projectId: randomUUID() },
      "Unknown project",
    );
    for (const [name, args] of [
      ["create_project", { name: " " }],
      ["get_project", { projectId: "not-a-uuid" }],
      ["submit_note", { projectId: project.id, ...note, markdown: " " }],
      [
        "submit_note",
        { projectId: project.id, ...note, sourceDate: "2026-02-30" },
      ],
      [
        "resolve_review",
        {
          projectId: project.id,
          candidateId: randomUUID(),
          action: "accept",
          expectedRevision: -1,
        },
      ],
    ] as const) {
      await error(ctx, name, args);
    }
    expect(ctx.ingest).not.toHaveBeenCalled();
    expect(ctx.store.runs(project.id)).toEqual([]);
    await closeHTTP(ctx.http);
    const failed = await error(ctx, "list_projects", {});
    expect(failed.structuredContent).toMatchObject({
      status: "error",
      error: expect.any(String),
    });
    expect(envelopeSchema.parse(failed.structuredContent).data).toBeUndefined();
  });
});

describe("manager MCP configuration", () => {
  it.each([
    "http://127.0.0.1:8788",
    "http://localhost:8788/",
    "http://[::1]:8788",
  ])("accepts loopback HTTP origin %s", (url) => {
    expect(() => createManagerClient(url)).not.toThrow();
  });
  it.each([
    "https://localhost:8788",
    "http://example.com:8788",
    "http://127.0.0.1.example.com",
    "http://user:secret@localhost:8788",
    "http://localhost:8788/rpc",
    "http://localhost:8788/?token=secret",
    "http://localhost:8788/#fragment",
    "file:///tmp/manager",
    "not a URL",
  ])("rejects unsupported manager address %s", (url) => {
    expect(() => createManagerClient(url)).toThrow();
  });
});

describe("manager MCP stdio entry", () => {
  it("discovers tools through the real entry point and exits cleanly on stdin EOF", async () => {
    const ctx = await context();
    const cwd = fileURLToPath(new URL("../../", import.meta.url));
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/mcp/main.ts"],
      {
        cwd,
        env: { PATH: process.env.PATH, PROJECT_MANAGER_URL: ctx.url },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    cleanup.push(async () => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    const messages: Array<Record<string, unknown>> = [];
    const invalid: string[] = [];
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        messages.push(JSON.parse(line));
      } catch {
        invalid.push(line);
      }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "stdio-test", version: "1.0.0" } } })}\n`,
    );
    await vi.waitFor(
      () => expect(messages.some((message) => message.id === 1)).toBe(true),
      { timeout: 5000 },
    );
    const initialization = messages.find((message) => message.id === 1)!;
    expect(initialization).toMatchObject({
      result: { serverInfo: { name: "project-manager" } },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
    );
    await vi.waitFor(
      () => expect(messages.some((message) => message.id === 2)).toBe(true),
      { timeout: 5000 },
    );
    const listing = messages.find((message) => message.id === 2)!;
    expect(listing).toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "submit_note" }),
          expect.objectContaining({ name: "get_run" }),
        ]),
      },
    });
    const listed = listing.result as { tools: unknown[] };
    expect(listed.tools).toHaveLength(11);
    child.stdin.end();
    expect(await exited).toEqual({ code: 0, signal: null });
    expect(invalid).toEqual([]);
    expect(stderr).toBe("");
    expect(await ctx.caller.projects.list()).toEqual([]);
  }, 15000);
});
