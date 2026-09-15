import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  resultSchema,
  ingestReportSchema,
  searchReportSchema,
  answerSchema,
  correctionSchema,
  clusteringReportSchema,
  backfillReportSchema,
} from "../src/application/contracts.ts";
import { acquireIngestionLock } from "../src/application/ingestionLock.ts";

/** A deterministic client standing in for a supervisor; no agent planning loop. */
export async function runMcpEvaluation() {
  const root = await mkdtemp(path.join(tmpdir(), "ingest-mcp-eval-"));
  const client = new Client(
    { name: "offline-supervisor-example", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      fileURLToPath(import.meta.resolve("tsx")),
      fileURLToPath(new URL("./mcpFixtureServer.ts", import.meta.url)),
      root,
    ],
    cwd: root,
  });
  try {
    await mkdir(path.join(root, "inbox"));
    await writeFile(
      path.join(root, "inbox", "cache.md"),
      "# Database cache\nMeasure cache hit rate. Choose explicit TTLs and rehearse cache invalidation before rollout.\n",
    );
    await writeFile(
      path.join(root, "inbox", "invalid.md"),
      Buffer.from([0xff]),
    );
    await client.connect(transport);
    const listing = await client.listTools();
    assert.equal(listing.tools.length, 6);
    assert.ok(
      listing.tools.every((tool) => tool.inputSchema && tool.outputSchema),
    );
    const ingestionCall = await client.callTool({
      name: "ingest_inbox",
      arguments: {},
    });
    const ingestion = resultSchema(ingestReportSchema).parse(
      ingestionCall.structuredContent,
    );
    assert.equal(ingestion.status, "partial");
    assert.equal(ingestionCall.isError, true);
    assert.deepEqual(ingestion.data?.counts, {
      total: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
    });
    const search = resultSchema(searchReportSchema).parse(
      (
        await client.callTool({
          name: "search_documents",
          arguments: { question: "database cache hit rate TTLs invalidation" },
        })
      ).structuredContent,
    );
    assert.equal(search.status, "success");
    assert.ok(search.data?.sources.length);
    const answer = resultSchema(answerSchema).parse(
      (
        await client.callTool({
          name: "ask_question",
          arguments: { question: "database cache hit rate TTLs invalidation" },
        })
      ).structuredContent,
    );
    assert.ok(answer.data?.sources.length);
    const correction = resultSchema(correctionSchema).parse(
      (
        await client.callTool({
          name: "record_correction",
          arguments: {
            originalPath: "inbox/cache.md",
            wrongCategory: "reference_material",
            correctCategory: "architecture_code",
          },
        })
      ).structuredContent,
    );
    assert.equal(correction.status, "success");
    const splits = resultSchema(clusteringReportSchema).parse(
      (
        await client.callTool({
          name: "suggest_category_splits",
          arguments: {},
        })
      ).structuredContent,
    );
    assert.equal(splits.status, "success");
    await assert.rejects(access(path.join(root, "cluster-suggestions.json")));
    const backfill = resultSchema(backfillReportSchema).parse(
      (await client.callTool({ name: "backfill_embeddings", arguments: {} }))
        .structuredContent,
    );
    assert.equal(backfill.status, "success");
    const release = await acquireIngestionLock(root);
    try {
      const busy = resultSchema(ingestReportSchema).parse(
        (await client.callTool({ name: "ingest_inbox", arguments: {} }))
          .structuredContent,
      );
      assert.equal(busy.error?.code, "LIBRARY_BUSY");
    } finally {
      await release();
    }
    return {
      passed: true,
      tools: listing.tools.map((tool) => tool.name),
      ingestion: ingestion.data?.counts,
      sources: search.data?.sources.length,
      partialFailureVisible: true,
      busyRunRejected: true,
      clusteringWritesReport: false,
      liveModelCalls: 0,
    };
  } finally {
    await client.close();
    await transport.close();
    await rm(root, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runMcpEvaluation()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
