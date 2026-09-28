/**
 * The MCP server's executable entry point.
 *
 * Argument parsing is deliberately strict and stdout is reserved entirely for
 * the protocol: a stray log line here corrupts the stream an MCP host reads.
 * `--root` is required, because a supervisor must state which library it means
 * rather than inheriting the current directory.
 */
import { config as loadEnvFile } from "dotenv";
import { createModelClient } from "../providers/create-client.ts";
import { startClassifierStdio } from "./stdio.ts";

/** Parse arguments, load the environment, and start the stdio server. */
function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let root: string | undefined;
  let envFile: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value?.trim() || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    if (flag === "--root" && !root) root = value;
    else if (flag === "--env-file" && !envFile) envFile = value;
    else throw new Error(`Unknown or repeated option ${flag}`);
  }
  if (!root)
    throw new Error("--root <library> is required for the MCP server.");
  const loaded = loadEnvFile({
    quiet: true,
    ...(envFile ? { path: envFile } : {}),
  });
  if (envFile && loaded.error) throw loaded.error;
  const threshold = process.env.INGEST_CATEGORY_DEDUP_THRESHOLD;
  startClassifierStdio({
    root,
    createModel: () => createModelClient(),
    dedupThreshold: threshold ? Number(threshold) : undefined,
  });
}
try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
