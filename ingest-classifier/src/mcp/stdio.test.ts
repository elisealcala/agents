import { afterEach, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { acquireIngestionLock } from "../application/ingestionLock.ts";
import {
  ingestReportSchema,
  resultSchema,
  searchReportSchema,
} from "../application/contracts.ts";

const roots: string[] = [];
const clients: Client[] = [];
const execute = promisify(execFile);
const loader = fileURLToPath(import.meta.resolve("tsx"));
const productionEntry = fileURLToPath(new URL("./main.ts", import.meta.url));
const fixtureEntry = fileURLToPath(
  new URL("../../evals/mcpFixtureServer.ts", import.meta.url),
);
const cliEntry = fileURLToPath(new URL("../cli.ts", import.meta.url));
const offlineEnv = {
  PATH: process.env.PATH ?? "",
  DOTENV_CONFIG_QUIET: "true",
};
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-stdio-test-"));
  roots.push(directory);
  return directory;
}
async function connect(
  directory: string,
  fixture = false,
  mode: "auto" | "legacy" = "legacy",
) {
  const client = new Client(
    { name: "offline-test-supervisor", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  clients.push(client);
  const errors: Error[] = [];
  client.onerror = (error) => errors.push(error);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      loader,
      fixture ? fixtureEntry : productionEntry,
      ...(fixture ? [directory] : ["--root", directory]),
    ],
    cwd: directory,
    env: offlineEnv,
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {
    /* Drain diagnostics without writing to stdout. */
  });
  await client.connect(transport);
  return { client, errors };
}
async function cli(directory: string, args: string[]) {
  return execute(
    process.execPath,
    ["--import", loader, cliEntry, ...args, "--root", directory],
    { cwd: directory, env: offlineEnv },
  );
}

async function fixtureCli(directory: string, args: string[]) {
  const preload = path.join(directory, "offline-provider-preload.mjs");
  const providerUrl = new URL("../providers/createClient.ts", import.meta.url)
    .href;
  const fixtureUrl = new URL(
    "../../evals/adaptiveFixtureModel.ts",
    import.meta.url,
  ).href;
  // Replace only the provider factory in this disposable child process. The real
  // CLI, application, database, and file-processing modules execute unchanged.
  const source = `import { AdaptiveFixtureModelClient } from ${JSON.stringify(fixtureUrl)};
export function createModelClient() { return new AdaptiveFixtureModelClient(); }`;
  await writeFile(
    path.join(directory, "offline-provider-loader.mjs"),
    `export async function load(url, context, nextLoad) {
  if (url.split("?")[0] === ${JSON.stringify(providerUrl)}) {
    return { format: "module", source: ${JSON.stringify(source)}, shortCircuit: true };
  }
  return await nextLoad(url, context);
}
`,
  );
  await writeFile(
    preload,
    `import { register } from "node:module";
register(new URL("./offline-provider-loader.mjs", import.meta.url), import.meta.url);
`,
  );
  return execute(
    process.execPath,
    [
      "--import",
      loader,
      "--import",
      preload,
      cliEntry,
      ...args,
      "--root",
      directory,
    ],
    { cwd: directory, env: offlineEnv },
  );
}

describe("MCP stdio adapter", () => {
  it.each(["legacy", "auto"] as const)(
    "discovers schemas and runs local tools with no credentials in %s mode",
    async (mode) => {
      const directory = await root();
      await writeFile(
        path.join(directory, ".env"),
        "TEST_ONLY_QUIET_ENV=value\n",
      );
      const { client, errors } = await connect(directory, false, mode);
      const listing = await client.listTools();
      expect(listing.tools.map((tool) => tool.name).sort()).toEqual([
        "ask_question",
        "backfill_embeddings",
        "ingest_inbox",
        "record_correction",
        "search_documents",
        "suggest_category_splits",
      ]);
      for (const tool of listing.tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.outputSchema).toBeTruthy();
        expect(tool.inputSchema.properties).not.toHaveProperty("root");
      }
      for (const [name, args] of [
        ["search_documents", { question: "cache" }],
        ["suggest_category_splits", {}],
        ["backfill_embeddings", {}],
        [
          "record_correction",
          { originalPath: "note.md", wrongCategory: "a", correctCategory: "b" },
        ],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toMatchObject({
          status: "success",
          error: null,
        });
        expect(result.content).toEqual([
          { type: "text", text: JSON.stringify(result.structuredContent) },
        ]);
      }
      for (const [name, args] of [
        ["ingest_inbox", {}],
        ["ask_question", { question: "cache" }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          status: "error",
          error: { code: "MODEL_CONFIGURATION" },
        });
      }
      await expect(
        access(path.join(directory, "cluster-suggestions.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(errors).toEqual([]);
    },
    15000,
  );

  it("runs fixture ingestion and returns partial failures and retrieval through real stdio", async () => {
    const directory = await root();
    await mkdir(path.join(directory, "inbox"));
    await writeFile(
      path.join(directory, "inbox", "cache.md"),
      "# Cache architecture\nDatabase TTLs and cache invalidation.",
    );
    await writeFile(
      path.join(directory, "inbox", "bad.md"),
      Buffer.from([0xff]),
    );
    const { client, errors } = await connect(directory, true);
    await client.listTools();
    const result = await client.callTool({
      name: "ingest_inbox",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const report = resultSchema(ingestReportSchema).parse(
      result.structuredContent,
    );
    expect(report).toMatchObject({
      status: "partial",
      error: { code: "INCOMPLETE" },
      data: { counts: { total: 2, succeeded: 1, failed: 1, skipped: 0 } },
    });
    const found = await client.callTool({
      name: "search_documents",
      arguments: { question: "database cache", minimumScore: -1 },
    });
    expect(
      resultSchema(searchReportSchema).parse(found.structuredContent).data
        ?.sources,
    ).toHaveLength(1);
    const failed = await client.callTool({
      name: "ingest_inbox",
      arguments: {},
    });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({
      status: "error",
      data: { counts: { succeeded: 0, failed: 1 } },
    });
    const release = await acquireIngestionLock(directory);
    try {
      const busy = await client.callTool({
        name: "ingest_inbox",
        arguments: {},
      });
      expect(busy.isError).toBe(true);
      expect(busy.structuredContent).toMatchObject({
        error: { code: "LIBRARY_BUSY" },
      });
    } finally {
      await release();
    }
    expect(errors).toEqual([]);
  }, 15000);

  it("rejects invalid tool input without performing ingestion", async () => {
    const directory = await root();
    const { client } = await connect(directory);
    await client.listTools();
    // SDKs may reject before dispatch or return the server's tool error.
    const result = await client
      .callTool({ name: "search_documents", arguments: { question: " " } })
      .catch((error: unknown) => error);
    if (result instanceof Error)
      expect(result.message).toMatch(/valid|question|string/i);
    else expect(result).toMatchObject({ isError: true });
    const release = await acquireIngestionLock(directory);
    await release();
  });

  it("finishes active ingestion before exiting when the client closes stdin", async () => {
    const directory = await root();
    await mkdir(path.join(directory, "inbox"));
    await writeFile(
      path.join(directory, "inbox", "active.md"),
      "# Cache architecture\nDatabase TTLs.",
    );
    const stdioModule = new URL("./stdio.ts", import.meta.url).href;
    const fixtureModule = new URL(
      "../../evals/adaptiveFixtureModel.ts",
      import.meta.url,
    ).href;
    const script = `import { startClassifierStdio } from ${JSON.stringify(stdioModule)};
import { AdaptiveFixtureModelClient } from ${JSON.stringify(fixtureModule)};
const fixture = new AdaptiveFixtureModelClient();
startClassifierStdio({ root: process.argv[1], model: { provider: 'openai', model: 'offline-slow-fixture', async complete(prompt) {
  console.error('MODEL_ENTERED');
  await new Promise(resolve => setTimeout(resolve, 150));
  return fixture.complete(prompt);
} } });`;
    const child = spawn(
      process.execPath,
      ["--import", loader, "--input-type=module", "--eval", script, directory],
      { cwd: directory, env: offlineEnv, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let requested = false;
    let endedInput = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (
        !requested &&
        stdout.split("\n").some((line) => line.includes('"id":1'))
      ) {
        requested = true;
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
        );
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ingest_inbox", arguments: {} } })}\n`,
        );
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (!endedInput && stderr.includes("MODEL_ENTERED")) {
        endedInput = true;
        child.stdin.end();
      }
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw-offline-client", version: "1.0.0" } } })}\n`,
    );
    const timeout = setTimeout(() => child.kill("SIGKILL"), 8000);
    try {
      expect(await exited).toBe(0);
      expect(endedInput).toBe(true);
      const messages = stdout
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              id?: number;
              result?: { structuredContent?: unknown };
            },
        );
      expect(
        messages.find((message) => message.id === 2)?.result?.structuredContent,
      ).toMatchObject({
        status: "success",
        data: { counts: { succeeded: 1, failed: 0 } },
      });
      await expect(
        access(path.join(directory, "inbox", "active.md")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const release = await acquireIngestionLock(directory);
      await release();
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 10000);

  it("requires an explicit root and reports startup errors only on stderr", async () => {
    const directory = await root();
    await expect(
      execute(process.execPath, ["--import", loader, productionEntry], {
        cwd: directory,
        env: offlineEnv,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("--root <library> is required"),
    });
  });
});

describe("standalone CLI compatibility", () => {
  it("preserves the successful run array and grounded ask answer with the real CLI", async () => {
    const directory = await root();
    await mkdir(path.join(directory, "inbox"));
    await writeFile(
      path.join(directory, "inbox", "cache.md"),
      "# Database cache\nMeasure cache hit rate. Choose explicit TTLs and rehearse cache invalidation before rollout.",
    );
    const run = await fixtureCli(directory, ["run"]);
    const results = JSON.parse(run.stdout) as Array<{
      status: string;
      destinationPath: string;
    }>;
    expect(Array.isArray(results)).toBe(true);
    expect(results).toEqual([
      expect.objectContaining({
        status: "ok",
        destinationPath: expect.stringContaining("cache.md"),
        categoryAction: "existing",
      }),
    ]);
    const answer = JSON.parse(
      (
        await fixtureCli(directory, [
          "ask",
          "--question",
          "database cache hit rate TTLs invalidation",
        ])
      ).stdout,
    ) as {
      answer: string;
      sources: Array<{ path: string; score: number; snippet: string }>;
    };
    expect(Object.keys(answer).sort()).toEqual(["answer", "sources"]);
    expect(answer.answer).toBe(
      `The grounded notes emphasize measuring cache hit rate, choosing explicit TTLs, and rehearsing invalidation before rollout.\n\nSources:\n- ${results[0]!.destinationPath}`,
    );
    expect(answer.sources).toEqual([
      expect.objectContaining({
        path: results[0]!.destinationPath,
        score: expect.any(Number),
        snippet: expect.stringContaining("TTL"),
      }),
    ]);
  });

  it("keeps exit zero and the raw per-file array when a run only partly succeeds", async () => {
    const directory = await root();
    await mkdir(path.join(directory, "inbox"));
    await writeFile(
      path.join(directory, "inbox", "good.md"),
      "# Cache architecture\nDatabase TTLs.",
    );
    await writeFile(
      path.join(directory, "inbox", "invalid.md"),
      Buffer.from([0xff]),
    );
    // execFile rejects nonzero exits, so resolving here preserves exit-zero behavior.
    const run = await fixtureCli(directory, ["run"]);
    const results = JSON.parse(run.stdout) as Array<{ status: string }>;
    expect(Array.isArray(results)).toBe(true);
    expect(results.map((result) => result.status).sort()).toEqual([
      "failed",
      "ok",
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          sourcePath: path.join(directory, "inbox", "invalid.md"),
          error: expect.any(String),
        }),
      ]),
    );
    await expect(
      access(path.join(directory, "inbox", "good.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(directory, "inbox", "invalid.md"))).toEqual(
      Buffer.from([0xff]),
    );
  });

  it("keeps correction and backfill output unwrapped and writes clustering reports", async () => {
    const directory = await root();
    const corrected = JSON.parse(
      (
        await cli(directory, [
          "correct",
          "--path",
          "note.md",
          "--wrong",
          "a",
          "--correct",
          "b",
        ])
      ).stdout,
    ) as Record<string, unknown>;
    expect(corrected).toMatchObject({
      originalPath: "note.md",
      wrongCategory: "a",
      correctCategory: "b",
    });
    expect(corrected).not.toHaveProperty("status");
    expect(JSON.parse((await cli(directory, ["backfill"])).stdout)).toEqual({
      examined: 0,
      created: 0,
      repaired: 0,
      failed: 0,
    });
    const clustered = JSON.parse(
      (await cli(directory, ["cluster"])).stdout,
    ) as Record<string, unknown>;
    expect(clustered).toMatchObject({ examinedCategories: 0, suggestions: [] });
    expect(
      JSON.parse(
        await readFile(
          path.join(directory, "cluster-suggestions.json"),
          "utf8",
        ),
      ),
    ).toEqual(clustered);
  });

  it("exits nonzero on ingestion contention before requiring model credentials", async () => {
    const directory = await root();
    const release = await acquireIngestionLock(directory);
    try {
      await expect(cli(directory, ["run"])).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("already locked"),
      });
    } finally {
      await release();
    }
  });
});
