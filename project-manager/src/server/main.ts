/** Local-only manager service; drain active work before closing its SQLite database. */
import { createServer } from "node:http";
import path from "node:path";
import { config } from "dotenv";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { Manager } from "../application/manager.ts";
import { Store } from "../storage/store.ts";
import { createAnthropicModel } from "../providers/anthropic.ts";
import { createWorker } from "../providers/worker.ts";
import { appRouter } from "./router.ts";
config({ quiet: true });
const libraryRoot = process.env.PROJECT_MANAGER_LIBRARY_ROOT;
if (!libraryRoot || !path.isAbsolute(libraryRoot))
  throw new Error(
    "PROJECT_MANAGER_LIBRARY_ROOT must be an absolute dedicated library path",
  );
const model =
  process.env.PROJECT_MANAGER_MODEL ??
  process.env.INGEST_MODEL ??
  "unconfigured";
const store = new Store(
  process.env.PROJECT_MANAGER_DATABASE ?? ".data/projects.sqlite",
);
const manager = new Manager(
  store,
  createWorker(
    process.env.PROJECT_MANAGER_CLASSIFIER_URL ?? "http://127.0.0.1:8789",
  ),
  createAnthropicModel({ model }),
  { libraryRoot },
);
const handler = createHTTPHandler({
  router: appRouter,
  createContext: () => ({ manager, model }),
});
const origin = process.env.STUDIO_ORIGIN ?? "http://localhost:3000";
const port = Number(process.env.PROJECT_MANAGER_PORT ?? "8788");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PROJECT_MANAGER_PORT");
const server = createServer((req, res) => {
  if (req.headers.origin && req.headers.origin !== origin) {
    res.writeHead(403);
    res.end();
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,trpc-accept");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  handler(req, res);
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Project manager: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () =>
    server.close(() => {
      void manager.close().finally(() => store.close());
    }),
  );
