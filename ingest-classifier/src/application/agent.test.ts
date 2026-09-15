import { afterEach, describe, expect, it, vi } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createIngestAgent,
  type IngestAgent,
  type IngestAgentOptions,
} from "./agent.ts";
import { acquireIngestionLock, INGESTION_LOCK_NAME } from "./ingestionLock.ts";
import { AdaptiveFixtureModelClient } from "../../evals/adaptiveFixtureModel.ts";
import { AdaptiveIngestPipeline } from "../pipelines/adaptivePipeline.ts";
import { AuditStore } from "../storage/audit.ts";
import { DocumentStore } from "../storage/documents.ts";
import { CorrectionStore } from "../storage/corrections.ts";
import type { ModelClient } from "../providers/types.ts";

const roots: string[] = [];
const agents: IngestAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()));
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function setup(options: Partial<Omit<IngestAgentOptions, "root">> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-operations-test-"));
  roots.push(root);
  await mkdir(path.join(root, "inbox"));
  const agent = createIngestAgent({ root, ...options });
  agents.push(agent);
  return { root, agent };
}
function model(complete: ModelClient["complete"]): ModelClient {
  return { provider: "openai", model: "offline-test", complete };
}

describe("shared classifier operations", () => {
  it("validates every operation before configuration, files, or model calls", async () => {
    const createModel = vi.fn(() => {
      throw new Error("must not configure");
    });
    const { root, agent } = await setup({ createModel });
    const results = await Promise.all([
      agent.ingestInbox({ root: "/another-library" }),
      agent.searchDocuments({ question: " " }),
      agent.searchDocuments({ question: "notes", topK: 0 }),
      agent.askQuestion({ question: "notes", minimumScore: 2 }),
      agent.recordCorrection({
        originalPath: "x",
        wrongCategory: "a",
        correctCategory: " ",
      }),
      agent.suggestCategorySplits({ minimumCategorySize: 0 }),
      agent.suggestCategorySplits({ output: "report.json" }),
      agent.backfillEmbeddings({ unexpected: true }),
    ]);
    for (const result of results)
      expect(result).toMatchObject({
        status: "error",
        data: null,
        error: { code: "INVALID_INPUT" },
      });
    expect(createModel).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(["inbox"]);
  });

  it("runs local operations without configuring a model or creating a clustering report", async () => {
    const createModel = vi.fn(() => {
      throw new Error("no credentials");
    });
    const { root, agent } = await setup({ createModel });
    expect(await agent.searchDocuments({ question: "database" })).toEqual({
      status: "success",
      data: { sources: [] },
      error: null,
    });
    expect(await agent.suggestCategorySplits()).toMatchObject({
      status: "success",
      data: { examinedCategories: 0, suggestions: [] },
    });
    expect(await agent.backfillEmbeddings()).toEqual({
      status: "success",
      data: { examined: 0, created: 0, repaired: 0, failed: 0 },
      error: null,
    });
    expect(
      await agent.recordCorrection({
        originalPath: "inbox/note.md",
        wrongCategory: "a",
        correctCategory: "b",
      }),
    ).toMatchObject({
      status: "success",
      data: { originalPath: "inbox/note.md", note: null },
    });
    expect(createModel).not.toHaveBeenCalled();
    await expect(
      access(path.join(root, "cluster-suggestions.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    for (const result of [
      await agent.ingestInbox(),
      await agent.askQuestion({ question: "database" }),
    ]) {
      expect(result).toMatchObject({
        status: "error",
        error: { code: "MODEL_CONFIGURATION" },
      });
    }
    await expect(
      access(path.join(root, INGESTION_LOCK_NAME)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ingests, retrieves, and answers from persisted notes with structured results", async () => {
    const { root, agent } = await setup({
      model: new AdaptiveFixtureModelClient(),
    });
    await writeFile(
      path.join(root, "inbox", "cache.md"),
      "# Cache architecture\nMeasure cache hit rate and explicit TTLs.",
    );
    const result = await agent.ingestInbox();
    expect(result).toMatchObject({
      status: "success",
      error: null,
      data: {
        counts: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
        results: [expect.objectContaining({ status: "ok" })],
      },
    });
    const retrieved = await agent.searchDocuments({
      question: "cache architecture",
      minimumScore: -1,
    });
    expect(retrieved.data?.sources).toEqual([
      expect.objectContaining({
        path: expect.stringContaining("cache.md"),
        summary: expect.any(String),
        snippet: expect.stringContaining("TTL"),
      }),
    ]);
    const answer = await agent.askQuestion({
      question: "cache architecture",
      minimumScore: -1,
    });
    expect(answer.status).toBe("success");
    expect(answer.data?.sources).toHaveLength(1);
    expect(answer.data?.answer).toContain("Sources:");
    expect(await readdir(path.join(root, "inbox"))).toEqual([]);
  });

  it.each([false, true])(
    "retains file reports for failed batches (mixed=%s)",
    async (mixed) => {
      const fixture = new AdaptiveFixtureModelClient();
      const { root, agent } = await setup({
        model: model(async (prompt) => {
          if (prompt.includes("FAIL_THIS_NOTE"))
            throw new Error("fixture model failure");
          return fixture.complete(prompt);
        }),
      });
      await writeFile(
        path.join(root, "inbox", "bad.md"),
        "# FAIL_THIS_NOTE\nKeep original bytes.",
      );
      if (mixed)
        await writeFile(
          path.join(root, "inbox", "good.md"),
          "# Cache architecture\nDatabase design.",
        );
      expect(await agent.ingestInbox()).toMatchObject({
        status: mixed ? "partial" : "error",
        error: { code: "INCOMPLETE" },
        data: {
          counts: {
            total: mixed ? 2 : 1,
            succeeded: mixed ? 1 : 0,
            failed: 1,
            skipped: 0,
          },
          results: expect.arrayContaining([
            expect.objectContaining({
              status: "failed",
              error: expect.stringContaining("fixture model failure"),
            }),
          ]),
        },
      });
      expect(
        await readFile(path.join(root, "inbox", "bad.md"), "utf8"),
      ).toContain("Keep original bytes");
      const release = await acquireIngestionLock(root);
      await release();
    },
  );

  it("treats empty and entirely skipped inboxes as successful", async () => {
    const { root, agent } = await setup({
      model: new AdaptiveFixtureModelClient(),
    });
    expect(await agent.ingestInbox()).toMatchObject({
      status: "success",
      data: { counts: { total: 0, succeeded: 0, failed: 0, skipped: 0 } },
    });
    await writeFile(path.join(root, "inbox", "image.txt"), "not markdown");
    expect(await agent.ingestInbox()).toMatchObject({
      status: "success",
      data: {
        counts: { total: 1, succeeded: 0, failed: 0, skipped: 1 },
        results: [
          {
            status: "skipped",
            sourcePath: path.join(root, "inbox", "image.txt"),
            reason: "non-Markdown file",
          },
        ],
      },
    });
  });

  it("reports and repairs embedding failures without losing successful ingestion", async () => {
    let fail = true;
    const { root, agent } = await setup({
      model: new AdaptiveFixtureModelClient(),
      embeddingProvider: {
        id: "offline-repair",
        dimensions: 2,
        async embed(text) {
          if (fail && text.includes("Repairable document"))
            throw new Error("embedding offline");
          return [1, 0];
        },
      },
    });
    await writeFile(
      path.join(root, "inbox", "repair.md"),
      "# Repairable document\nCache architecture.",
    );
    expect((await agent.ingestInbox()).status).toBe("success");
    expect(await agent.backfillEmbeddings()).toMatchObject({
      status: "error",
      error: { code: "INCOMPLETE" },
      data: { examined: 1, failed: 1 },
    });
    fail = false;
    expect(await agent.backfillEmbeddings()).toMatchObject({
      status: "success",
      data: { repaired: 1, failed: 0 },
    });
  });

  it("waits for active work before closing and rejects new operations while closing", async () => {
    let resolveModel!: () => void;
    let enteredModel!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveModel = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      enteredModel = resolve;
    });
    const fixture = new AdaptiveFixtureModelClient();
    const { root, agent } = await setup({
      model: model(async (prompt) => {
        enteredModel();
        await gate;
        return fixture.complete(prompt);
      }),
    });
    await writeFile(
      path.join(root, "inbox", "active.md"),
      "# Cache architecture",
    );
    const run = agent.ingestInbox();
    await entered;
    let closed = false;
    const closing = agent.close().then(() => {
      closed = true;
    });
    try {
      expect(await agent.searchDocuments({ question: "cache" })).toMatchObject({
        error: { code: "APPLICATION_CLOSED" },
      });
      expect(closed).toBe(false);
      await expect(acquireIngestionLock(root)).rejects.toMatchObject({
        code: "LIBRARY_BUSY",
      });
    } finally {
      resolveModel();
    }
    expect((await run).status).toBe("success");
    await closing;
    const release = await acquireIngestionLock(root);
    await release();
  });

  it("holds the watch lock between scans and releases it on graceful close", async () => {
    const { root, agent } = await setup({
      model: new AdaptiveFixtureModelClient(),
      pollIntervalMs: 60000,
    });
    let scanned!: () => void;
    const firstScan = new Promise<void>((resolve) => {
      scanned = resolve;
    });
    const original = AdaptiveIngestPipeline.prototype.scanOnce;
    vi.spyOn(AdaptiveIngestPipeline.prototype, "scanOnce").mockImplementation(
      async function (this: AdaptiveIngestPipeline) {
        const result = await original.call(this);
        scanned();
        return result;
      },
    );
    const watching = agent.watch();
    await firstScan;
    try {
      await expect(acquireIngestionLock(root)).rejects.toMatchObject({
        code: "LIBRARY_BUSY",
      });
    } finally {
      await agent.close();
    }
    expect(await watching).toEqual({
      status: "success",
      data: null,
      error: null,
    });
    const release = await acquireIngestionLock(root);
    await release();
  });

  it("closes opened stores after failure and rejects invalid operation output", async () => {
    const { agent } = await setup({
      embeddingProvider: {
        id: "failing",
        dimensions: 2,
        async embed() {
          throw new Error("query embedding failed");
        },
      },
    });
    const auditClose = vi.spyOn(AuditStore.prototype, "close");
    const documentsClose = vi.spyOn(DocumentStore.prototype, "close");
    expect(await agent.searchDocuments({ question: "cache" })).toMatchObject({
      status: "error",
      error: { code: "OPERATION_FAILED", message: "query embedding failed" },
    });
    expect(auditClose).toHaveBeenCalledOnce();
    expect(documentsClose).toHaveBeenCalledOnce();
    vi.spyOn(CorrectionStore.prototype, "record").mockReturnValue({
      id: 1,
      originalPath: "",
      wrongCategory: "a",
      correctCategory: "b",
      note: null,
      createdAt: "now",
    });
    expect(
      await agent.recordCorrection({
        originalPath: "x",
        wrongCategory: "a",
        correctCategory: "b",
      }),
    ).toMatchObject({
      status: "error",
      data: null,
      error: { code: "INVALID_OUTPUT" },
    });
  });

  it("settles other files before releasing resources after an unexpected per-file rejection", async () => {
    let releaseModel!: () => void;
    let enteredModel!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      enteredModel = resolve;
    });
    const fixture = new AdaptiveFixtureModelClient();
    const { root, agent } = await setup({
      model: model(async (prompt) => {
        enteredModel();
        await gate;
        return fixture.complete(prompt);
      }),
    });
    await writeFile(path.join(root, "inbox", "reject.txt"), "non markdown");
    await writeFile(
      path.join(root, "inbox", "slow.md"),
      "# Cache architecture",
    );
    vi.spyOn(AuditStore.prototype, "skip").mockImplementation(() => {
      throw new Error("unexpected skip audit failure");
    });
    let settled = false;
    const run = agent.ingestInbox().then((result) => {
      settled = true;
      return result;
    });
    await entered;
    try {
      expect(settled).toBe(false);
      await expect(acquireIngestionLock(root)).rejects.toMatchObject({
        code: "LIBRARY_BUSY",
      });
    } finally {
      releaseModel();
    }
    expect(await run).toMatchObject({
      status: "partial",
      data: { counts: { total: 2, succeeded: 1, failed: 1, skipped: 0 } },
    });
  });
});
