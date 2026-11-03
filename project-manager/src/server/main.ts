/** Local-only manager service; drain active work before closing its SQLite database. */
import { createServer } from "node:http";
import { config } from "dotenv";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { Manager } from "../application/manager.ts";
import { Store } from "../storage/store.ts";
import { DeliveryScheduler } from "../delivery/scheduler.ts";
import { createAnthropicModel } from "../providers/anthropic.ts";
import { createWorker } from "../providers/worker.ts";
import { appRouter } from "./router.ts";
import { resolveRuntimeConfig } from "./runtime-config.ts";
import {
  hasDuplicateSecurityHeaders,
  parseHostedConfig,
  verifyServiceRequest,
} from "./auth.ts";
import type { Worker, Model } from "../application/contracts.ts";
config({ quiet: true });
const hosted = parseHostedConfig(process.env);
const runtime = resolveRuntimeConfig(process.env);
const unavailable = async (): Promise<never> => {
  throw new Error("The provider is not configured.");
};
const disabledWorker: Worker = {
  identity: unavailable,
  ingest: unavailable,
  read: unavailable,
  search: unavailable,
};
const disabledModel: Model = {
  name: "unconfigured",
  extract: unavailable,
  answer: unavailable,
};
const store = new Store(
  process.env.PROJECT_MANAGER_DATABASE ?? ".data/projects.sqlite",
);
const manager = new Manager(
  store,
  runtime.capabilities.evidence === "configured" && runtime.classifierUrl
    ? createWorker(runtime.classifierUrl)
    : disabledWorker,
  runtime.capabilities.model === "configured" && runtime.model
    ? createAnthropicModel({ model: runtime.model })
    : disabledModel,
  {
    libraryRoot: runtime.libraryRoot ?? undefined,
    canIntake: runtime.capabilities.intake === "configured",
    canAnswer: runtime.capabilities.conversation === "configured",
  },
);
const handler = createHTTPHandler({
  router: appRouter,
  createContext: () => ({
    manager,
    model: runtime.model ?? "unconfigured",
    capabilities: runtime.capabilities,
  }),
});
const origin = process.env.STUDIO_ORIGIN ?? "http://localhost:3000";
const port = Number(process.env.PROJECT_MANAGER_PORT ?? "8788");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PROJECT_MANAGER_PORT");
// No external adapters are enabled in Stage 1. Unknown kinds remain queued.
const scheduler = new DeliveryScheduler(store.delivery, {});
const server = createServer((req, res) => {
  if (
    hosted &&
    (hasDuplicateSecurityHeaders(req.headersDistinct) ||
      !verifyServiceRequest(req.headers, hosted))
  ) {
    res.writeHead(401, { "Cache-Control": "private, no-store" });
    res.end();
    return;
  }
  if (!hosted && req.headers.origin && req.headers.origin !== origin) {
    res.writeHead(403);
    res.end();
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  if (!hosted) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,trpc-accept");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  handler(req, res);
});
server.listen(port, hosted?.bindHost ?? "127.0.0.1", () => {
  scheduler.start();
  console.log(`Project manager listening on port ${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.close(() => {
      void Promise.allSettled([scheduler.stop(), manager.close()]).finally(() =>
        store.close(),
      );
    });
  });
