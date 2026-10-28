/** Thin local stdio bridge; the existing manager service owns all runtime state. */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createManagerClient, createManagerServer } from "./server.ts";

try {
  const client = createManagerClient(
    process.env.PROJECT_MANAGER_URL ?? "http://127.0.0.1:8788",
  );
  const handle = serveStdio(() => createManagerServer(client), {
    onerror: (error) => console.error(error.message),
  });
  let closing: Promise<void> | undefined;
  const stop = () => {
    closing ??= handle.close();
    void closing.catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdin.once("end", stop);
  process.stdin.once("error", stop);
  process.stdout.once("error", stop);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
