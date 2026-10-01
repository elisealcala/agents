/**
 * The standalone command-line entry point.
 *
 * Every command runs the same application operations the MCP server exposes,
 * so behavior cannot drift between supervised and standalone use (DEC-016).
 * Commands print JSON to stdout and signal failure with a non-zero exit.
 */
import { config as loadEnvFile } from "dotenv";
import { writeFile } from "node:fs/promises";
import { createModelClient } from "./providers/create-client.ts";
import { createIngestAgent, type IngestAgent } from "./application/agent.ts";
import {
  type OperationResult,
  OperationFailure,
} from "./application/contracts.ts";
import { getLibraryPaths } from "./taxonomy/taxonomy.ts";

loadEnvFile();
const SMOKE_SYSTEM = "Reply with the model id and nothing else.";
const SMOKE_USER = "Identify yourself.";

function readRoot(args: string[]): string {
  const index = args.indexOf("--root");
  return index >= 0 && args[index + 1] ? args[index + 1]! : process.cwd();
}
function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function requireOption(args: string[], name: string): string {
  const value = readOption(args, name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
/**
 * Take the payload out of an operation result, or throw.
 *
 * A batch that partly failed still carries its report, and printing it keeps
 * the original CLI behavior: per-file failures are visible in the output
 * rather than collapsing the whole run into an error. Only a result with no
 * data at all throws, and {@link OperationResult} guarantees such a result
 * carries an error, so there is nothing to fall back to.
 */
function unwrap<T>(result: OperationResult<T>): T {
  if (result.status !== "error") return result.data;
  // An all-failed batch still carries its report; print it and exit zero.
  if (result.data !== null) return result.data;
  throw new OperationFailure(result.error.code, result.error.message);
}

async function execute(
  command: string,
  args: string[],
  agent: IngestAgent,
): Promise<void> {
  const print = (data: unknown) => console.log(JSON.stringify(data, null, 2));
  if (command === "run") {
    print(unwrap(await agent.ingestInbox()).results);
  } else if (command === "watch") {
    const result = await agent.watch();
    if (result.error)
      throw new OperationFailure(result.error.code, result.error.message);
  } else if (command === "backfill") {
    print(unwrap(await agent.backfillEmbeddings()));
  } else if (command === "correct") {
    print(
      unwrap(
        await agent.recordCorrection({
          originalPath: requireOption(args, "--path"),
          wrongCategory: requireOption(args, "--wrong"),
          correctCategory: requireOption(args, "--correct"),
          note: readOption(args, "--note"),
        }),
      ),
    );
  } else if (command === "cluster") {
    const report = unwrap(await agent.suggestCategorySplits());
    const outputPath =
      readOption(args, "--output") ??
      `${getLibraryPaths(agent.root).root}/cluster-suggestions.json`;
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    print(report);
  } else if (command === "ask") {
    print(
      unwrap(
        await agent.askQuestion({
          question: requireOption(args, "--question"),
        }),
      ),
    );
  }
}

async function main(): Promise<void> {
  const [command = "smoke", ...args] = process.argv.slice(2);
  if (command === "smoke") {
    const client = createModelClient();
    const text = await client.complete({
      system: SMOKE_SYSTEM,
      user: SMOKE_USER,
    });
    console.log(
      JSON.stringify(
        { provider: client.provider, model: client.model, text },
        null,
        2,
      ),
    );
    return;
  }
  if (
    !["run", "watch", "backfill", "correct", "cluster", "ask"].includes(command)
  ) {
    throw new Error(
      `Unknown command "${command}". Use smoke, run, watch, backfill, correct, cluster, or ask.`,
    );
  }
  const configuredThreshold = process.env.INGEST_CATEGORY_DEDUP_THRESHOLD;
  const agent = createIngestAgent({
    root: readRoot(args),
    createModel: () => createModelClient(),
    dedupThreshold:
      (command === "run" || command === "watch") && configuredThreshold
        ? Number(configuredThreshold)
        : undefined,
  });
  const stop = () => {
    void agent.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await execute(command, args, agent);
  } finally {
    await agent.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
