/**
 * Wiring one agent, one server and one draining transport together.
 *
 * Nothing here writes to stdout: that stream belongs to the protocol alone.
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createIngestAgent,
  type IngestAgentOptions,
} from "../application/agent.ts";
import { createClassifierServer } from "./server.ts";
import { DrainingStdioTransport } from "./draining-transport.ts";

/**
 * Start one local server over stdio.
 *
 * The SDK negotiates both modern and legacy protocol versions, so a host on
 * either revision connects without configuration.
 */
export function startClassifierStdio(options: IngestAgentOptions): {
  close(): Promise<void>;
} {
  const agent = createIngestAgent(options);
  const transport = new DrainingStdioTransport();
  const handle = serveStdio(() => createClassifierServer(agent), {
    transport,
    onerror: (error) => console.error(error.message),
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        await agent.close();
        await transport.drain();
        await handle.close();
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
        process.stdin.removeListener("end", stop);
        process.stdin.removeListener("error", stop);
        process.stdout.removeListener("error", stop);
      }
    })();
    return closing;
  };
  const stop = () => {
    void close().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdin.once("end", stop);
  process.stdin.once("error", stop);
  process.stdout.once("error", stop);
  return { close };
}
