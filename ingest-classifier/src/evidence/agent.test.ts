import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdaptiveFixtureModelClient } from "../../evals/adaptive-fixture-model.ts";
import { createIngestAgent } from "../application/agent.ts";
import { acquireIngestionLock } from "../application/ingestion-lock.ts";
import { AdaptiveIngestPipeline } from "../pipelines/adaptive-pipeline.ts";
import type { ModelClient } from "../providers/types.ts";
import type { EmbeddingProvider } from "../search/embeddings.ts";
import { AuditStore } from "../storage/audit.ts";
import { DocumentStore } from "../storage/documents.ts";
import { getLibraryPaths } from "../taxonomy/taxonomy.ts";
import {
  createEvidenceAgent,
  type EvidenceAgent,
  type EvidenceAgentOptions,
} from "./agent.ts";
import type { EvidenceIngestInput, EvidenceReceipt } from "./contracts.ts";
import { EvidenceStore, MAXIMUM_EVIDENCE_CHUNK_LENGTH } from "./store.ts";

const roots: string[] = [];
const agents: EvidenceAgent[] = [];

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()));
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function input(
  overrides: Partial<EvidenceIngestInput> = {},
): EvidenceIngestInput {
  return {
    projectId: "atlas",
    sourceId: "meeting-1",
    sourceVersion: "v1",
    idempotencyKey: "atlas-note-1",
    markdown: "# Architecture requirement\n\nTask Cache has owner Ava.\n",
    sourceDate: "2026-10-05",
    ...overrides,
  };
}

function constantEmbedding(id = "evidence-test-v1"): EmbeddingProvider {
  return { id, dimensions: 2, embed: vi.fn(async () => [1, 0]) };
}

async function setup(options: Partial<EvidenceAgentOptions> = {}) {
  const root =
    options.root ??
    (await mkdtemp(path.join(os.tmpdir(), "project-evidence-test-")));
  if (!options.root) roots.push(root);
  const agent = createEvidenceAgent({
    root,
    model: new AdaptiveFixtureModelClient(),
    embeddingProvider: constantEmbedding(),
    ...options,
  });
  agents.push(agent);
  return { root, agent };
}

async function ingest(
  agent: EvidenceAgent,
  note = input(),
): Promise<EvidenceReceipt> {
  const result = await agent.ingest(note);
  expect(result.status).toBe("success");
  if (result.status !== "success") throw new Error(result.error.message);
  return result.data;
}

describe("production project evidence boundary", () => {
  it("stores exact Markdown, files only the registered note and returns verifiable source offsets", async () => {
    const { root, agent } = await setup();
    await mkdir(path.join(root, "inbox"));
    await writeFile(
      path.join(root, "inbox", "unrelated.md"),
      "An unrelated inbox note.",
    );
    const markdown =
      "---\nproject: Atlas\n---\n\n# Cache architecture 🧭\r\n\r\nAva owns Cache.  \n\n";
    const receipt = await ingest(agent, input({ markdown }));
    expect(receipt).toMatchObject({
      storageStatus: "stored",
      indexStatus: "ready",
      checksum: createHash("sha256").update(markdown).digest("hex"),
    });
    expect(
      await agent.read({
        projectId: "atlas",
        documentRef: receipt.documentRef,
      }),
    ).toMatchObject({
      status: "success",
      data: { markdown, sourceDate: "2026-10-05" },
    });
    expect(await readdir(path.join(root, "inbox"))).toEqual(["unrelated.md"]);
    expect(
      await readFile(path.join(root, "inbox", "unrelated.md"), "utf8"),
    ).toBe("An unrelated inbox note.");
    const searched = await agent.search({
      projectId: "atlas",
      question: "Cache",
    });
    expect(searched.status).toBe("success");
    expect(searched.data?.missingEmbeddings).toBe(0);
    for (const passage of searched.data?.passages ?? []) {
      expect(passage.documentRef).toBe(receipt.documentRef);
      expect(passage.quote).toBe(markdown.slice(passage.start, passage.end));
    }
    expect(searched.data?.passages.length).toBeGreaterThan(0);
  });

  it("filters projects before top-K ranking and excludes legacy unassociated documents", async () => {
    const { root, agent } = await setup();
    await mkdir(path.join(root, "inbox"));
    await writeFile(
      path.join(root, "inbox", "legacy.md"),
      "# Cache architecture\nLegacy owner Secret.",
    );
    const legacy = createIngestAgent({
      root,
      model: new AdaptiveFixtureModelClient(),
      embeddingProvider: constantEmbedding(),
    });
    try {
      expect((await legacy.ingestInbox()).status).toBe("success");
    } finally {
      await legacy.close();
    }
    await ingest(
      agent,
      input({
        projectId: "atlas-plus",
        idempotencyKey: "other-key",
        markdown: "# Cache architecture\nForeign owner Zoe.",
      }),
    );
    const selected = await ingest(agent);
    const result = await agent.search({
      projectId: "atlas",
      question: "Cache",
      topK: 1,
    });
    expect(result.data?.passages).toEqual([
      expect.objectContaining({
        projectId: "atlas",
        documentRef: selected.documentRef,
      }),
    ]);
    expect(
      await agent.read({
        projectId: "atlas-plus",
        documentRef: selected.documentRef,
      }),
    ).toMatchObject({ status: "error", error: { code: "INVALID_INPUT" } });
    expect(
      await agent.search({ projectId: "unknown", question: "Cache" }),
    ).toMatchObject({
      status: "success",
      data: { passages: [], missingEmbeddings: 0 },
    });
  });

  it("reuses evidence across keys and restarts, but rejects changed source metadata or content", async () => {
    const { root, agent } = await setup();
    const first = await ingest(agent);
    expect(
      (await ingest(agent, input({ idempotencyKey: "alias-key" }))).documentRef,
    ).toBe(first.documentRef);
    for (const changed of [
      { markdown: "Different content" },
      { sourceId: "other" },
      { sourceVersion: "v2" },
      { sourceDate: "2026-10-06" },
      { projectId: "atlas-plus" },
    ]) {
      expect(await agent.ingest(input(changed))).toMatchObject({
        status: "error",
        data: null,
        error: { code: "INVALID_INPUT" },
      });
    }
    expect(
      await agent.ingest(
        input({ idempotencyKey: "new-key", markdown: "Different content" }),
      ),
    ).toMatchObject({ status: "error", error: { code: "INVALID_INPUT" } });
    await agent.close();
    const restarted = (await setup({ root })).agent;
    expect((await ingest(restarted)).documentRef).toBe(first.documentRef);
    const audits = new AuditStore(getLibraryPaths(root).database);
    try {
      expect(audits.list("ok")).toHaveLength(1);
    } finally {
      audits.close();
    }
  });

  it("preserves a readable snapshot when model configuration fails, and repairs only that reference", async () => {
    const { root, agent } = await setup({
      model: undefined,
      createModel: () => {
        throw new Error("model is unavailable");
      },
    });
    const result = await agent.ingest(input());
    expect(result).toMatchObject({
      status: "partial",
      data: {
        storageStatus: "stored",
        indexStatus: "missing",
        error: "model is unavailable",
      },
      error: { code: "INCOMPLETE" },
    });
    const receipt = result.data!;
    expect(
      await agent.read({
        projectId: "atlas",
        documentRef: receipt.documentRef,
      }),
    ).toMatchObject({
      status: "success",
      data: { markdown: input().markdown },
    });
    expect(
      await agent.search({ projectId: "atlas", question: "Cache" }),
    ).toMatchObject({ data: { passages: [], missingEmbeddings: 1 } });
    await agent.close();
    const restarted = (await setup({ root })).agent;
    expect(
      await restarted.retryIndex({
        projectId: "atlas",
        documentRef: receipt.documentRef,
      }),
    ).toMatchObject({
      status: "success",
      data: { documentRef: receipt.documentRef, indexStatus: "ready" },
    });
    expect(
      await restarted.retryIndex({
        projectId: "atlas-plus",
        documentRef: receipt.documentRef,
      }),
    ).toMatchObject({ status: "error", error: { code: "INVALID_INPUT" } });
  });

  it("reports incomplete embeddings and repairs from immutable bytes after the taxonomy copy changes", async () => {
    let fail = true;
    const embedded: string[] = [];
    const embeddingProvider: EmbeddingProvider = {
      id: "repair-test-v1",
      dimensions: 2,
      async embed(text) {
        embedded.push(text);
        if (fail && text.includes("OriginalProjectFact"))
          throw new Error("embedding unavailable");
        return [1, 0];
      },
    };
    const { root, agent } = await setup({ embeddingProvider });
    const markdown =
      "# Architecture\n\nOriginalProjectFact: Cache owner is Ava.\n";
    const first = await agent.ingest(input({ markdown }));
    expect(first).toMatchObject({
      status: "partial",
      data: { storageStatus: "stored", indexStatus: "missing" },
    });
    const receipt = first.data!;
    const documents = new DocumentStore(getLibraryPaths(root).database);
    let destination: string;
    try {
      destination = documents.list()[0]!.destinationPath;
    } finally {
      documents.close();
    }
    await writeFile(destination, "# Tampered taxonomy copy\nOwner is Mallory.");
    expect(
      await agent.search({ projectId: "atlas", question: "Cache" }),
    ).toMatchObject({ data: { passages: [], missingEmbeddings: 1 } });
    fail = false;
    embedded.length = 0;
    expect(
      await agent.retryIndex({
        projectId: "atlas",
        documentRef: receipt.documentRef,
      }),
    ).toMatchObject({ status: "success", data: { indexStatus: "ready" } });
    expect(embedded.some((text) => text.includes("OriginalProjectFact"))).toBe(
      true,
    );
    expect(embedded.some((text) => text.includes("Mallory"))).toBe(false);
    expect(
      await agent.read({
        projectId: "atlas",
        documentRef: receipt.documentRef,
      }),
    ).toMatchObject({ data: { markdown } });
    const audits = new AuditStore(getLibraryPaths(root).database);
    try {
      expect(audits.list("ok")).toHaveLength(1);
    } finally {
      audits.close();
    }
  });

  it("treats incompatible embedding providers as missing coverage until snapshot repair", async () => {
    const { root, agent } = await setup();
    const receipt = await ingest(agent);
    await agent.close();
    const migrated = (
      await setup({
        root,
        embeddingProvider: constantEmbedding("evidence-test-v2"),
      })
    ).agent;
    expect(
      await migrated.search({ projectId: "atlas", question: "Cache" }),
    ).toMatchObject({ data: { passages: [], missingEmbeddings: 1 } });
    expect(
      await migrated.retryIndex({
        projectId: "atlas",
        documentRef: receipt.documentRef,
      }),
    ).toMatchObject({ status: "success" });
    expect(
      await migrated.search({ projectId: "atlas", question: "Cache" }),
    ).toMatchObject({
      data: {
        missingEmbeddings: 0,
        passages: [
          expect.objectContaining({ documentRef: receipt.documentRef }),
        ],
      },
    });
  });

  it("bounds passage size and count without splitting Unicode surrogate pairs", async () => {
    const { agent } = await setup();
    const markdown = `# Architecture\n\n${"x".repeat(1481)}🧭${"a".repeat(10000)}`;
    await ingest(agent, input({ markdown }));
    const result = await agent.search({
      projectId: "atlas",
      question: "architecture",
      topK: 5,
    });
    expect(result.data?.passages).toHaveLength(5);
    for (const passage of result.data?.passages ?? []) {
      expect(passage.end - passage.start).toBeLessThanOrEqual(
        MAXIMUM_EVIDENCE_CHUNK_LENGTH,
      );
      expect(passage.quote).toBe(markdown.slice(passage.start, passage.end));
      expect(Buffer.from(passage.quote, "utf8").toString("utf8")).toBe(
        passage.quote,
      );
    }
    expect(
      await agent.search({
        projectId: "atlas",
        question: "architecture",
        topK: 6,
      }),
    ).toMatchObject({ status: "error", error: { code: "INVALID_INPUT" } });
  });

  it("recovers a filed source after interruption before the evidence association was saved", async () => {
    const { root, agent } = await setup();
    const store = new EvidenceStore(getLibraryPaths(root).database);
    const record = store.register(input());
    store.close();
    await mkdir(path.join(root, "inbox"));
    const source = path.join(root, "inbox", `${record.documentRef}.md`);
    await writeFile(source, record.markdown);
    const pipeline = new AdaptiveIngestPipeline({
      root,
      client: new AdaptiveFixtureModelClient(),
      embeddingProvider: constantEmbedding(),
    });
    try {
      expect((await pipeline.ingestFile(source)).status).toBe("ok");
    } finally {
      pipeline.close();
    }
    expect(
      await agent.retryIndex({
        projectId: "atlas",
        documentRef: record.documentRef,
      }),
    ).toMatchObject({
      status: "success",
      data: { documentRef: record.documentRef },
    });
    expect(await readdir(path.join(root, "inbox"))).toEqual([]);
    const audits = new AuditStore(getLibraryPaths(root).database);
    try {
      expect(audits.list("ok")).toHaveLength(1);
    } finally {
      audits.close();
    }
  });

  it("rejects invalid input and lock contention without producing an evidence receipt", async () => {
    const { root, agent } = await setup();
    expect(await agent.ingest(input({ markdown: "\uD800" }))).toMatchObject({
      status: "error",
      error: { code: "INVALID_INPUT" },
    });
    const release = await acquireIngestionLock(root);
    try {
      expect(await agent.ingest(input())).toMatchObject({
        status: "error",
        error: { code: "LIBRARY_BUSY" },
      });
    } finally {
      await release();
    }
    expect(
      await agent.search({ projectId: "atlas", question: "Cache" }),
    ).toMatchObject({ data: { passages: [], missingEmbeddings: 0 } });
    await agent.close();
    expect(
      await agent.read({ projectId: "atlas", documentRef: "unknown" }),
    ).toMatchObject({ status: "error", error: { code: "APPLICATION_CLOSED" } });
  });

  it("retains source evidence after classifier tool failures without marking indexing ready", async () => {
    const model: ModelClient = {
      provider: "anthropic",
      model: "failed-fixture",
      complete: async () => "",
      runTools: async () => {
        throw new Error("tool loop interrupted");
      },
    };
    const { agent } = await setup({ model });
    const failed = await agent.ingest(input());
    expect(failed).toMatchObject({
      status: "partial",
      data: { storageStatus: "stored", indexStatus: "missing" },
    });
    expect(
      await agent.read({
        projectId: "atlas",
        documentRef: failed.data!.documentRef,
      }),
    ).toMatchObject({
      status: "success",
      data: { markdown: input().markdown },
    });
  });
});
