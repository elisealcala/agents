/**
 * Localhost tRPC server for the studio.
 *
 * Bind is 127.0.0.1 only. The library root is a process flag, so a browser
 * request cannot point this process at a different folder.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { config as loadEnvFile } from "dotenv";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { createModelClient } from "../providers/create-client.ts";
import { getLibraryPaths } from "../taxonomy/taxonomy.ts";
import { StudioStore } from "../storage/studio.ts";
import { appRouter } from "./router.ts";

/** The studio listens here unless `--port` says otherwise. */
export const DEFAULT_STUDIO_PORT = 8787;

/** Browser origin allowed to call the server during `pnpm dev`. */
export const DEFAULT_STUDIO_ORIGIN = "http://localhost:3000";

/** Empty response for a CORS preflight. */
const NO_CONTENT = 204;

export type StudioServerOptions = {
  root: string;
  port?: number;
  origins?: string[];
  envFile?: string;
};

/** Start the server. The returned handle closes the database on `close`. */
export function startStudioServer(options: StudioServerOptions): Server {
  const loaded = loadEnvFile({
    quiet: true,
    ...(options.envFile ? { path: options.envFile } : {}),
  });
  if (options.envFile && loaded.error) throw loaded.error;
  const paths = getLibraryPaths(options.root);
  const store = new StudioStore(paths.database);
  const origins = new Set(options.origins ?? [DEFAULT_STUDIO_ORIGIN]);
  const threshold = process.env.INGEST_CATEGORY_DEDUP_THRESHOLD;
  const envDedupThreshold = threshold ? Number(threshold) : undefined;
  const handler = createHTTPHandler({
    router: appRouter,
    createContext: () => ({
      root: paths.root,
      store,
      createModel: () => createModelClient(),
      envDedupThreshold:
        envDedupThreshold !== undefined && Number.isFinite(envDedupThreshold)
          ? envDedupThreshold
          : undefined,
    }),
  });
  const server = createServer((req, res) => {
    if (!allowOrigin(req, res, origins)) return;
    handler(req, res);
  });
  server.on("close", () => {
    store.close();
  });
  server.listen(options.port ?? DEFAULT_STUDIO_PORT, "127.0.0.1");
  return server;
}

function allowOrigin(
  req: IncomingMessage,
  res: ServerResponse,
  origins: Set<string>,
): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, trpc-accept");
  if (req.method === "OPTIONS") {
    res.writeHead(NO_CONTENT);
    res.end();
    return false;
  }
  return true;
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let root: string | undefined;
  let envFile: string | undefined;
  let port = DEFAULT_STUDIO_PORT;
  const origins = [DEFAULT_STUDIO_ORIGIN];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value?.trim() || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === "--root" && !root) root = value;
    else if (flag === "--env-file" && !envFile) envFile = value;
    else if (flag === "--port") port = Number(value);
    else if (flag === "--origin") origins.push(value);
    else throw new Error(`Unknown or repeated option ${flag}`);
  }
  if (!root) throw new Error("--root <library> is required.");
  if (!Number.isInteger(port) || port < 1) {
    throw new Error("--port must be a positive integer");
  }
  const server = startStudioServer({ root, port, origins, envFile });
  const stop = () => {
    server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
