/** MCP adapter for the existing service: never opens another manager database. */
import { McpServer } from "@modelcontextprotocol/server";
import { createTRPCClient, httpLink } from "@trpc/client";
import { z } from "zod";
import type { AppRouter } from "../server/router.ts";

export type ManagerClient = ReturnType<typeof createTRPCClient<AppRouter>>;
const projectInput = z.object({ projectId: z.string().uuid() });
const text = z.string().trim().min(1);
const outputSchema = z.object({
  status: z.enum(["ok", "error"]),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
const readOnly = { readOnlyHint: true, openWorldHint: false };
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};

export function createManagerClient(url: string): ManagerClient {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error("Manager URL must be a local HTTP origin");
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: parsed.origin,
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      }),
    ],
  });
}

async function respond(operation: () => Promise<unknown>) {
  let result: z.infer<typeof outputSchema>;
  try {
    const data = await operation();
    // A successfully read failed run is still a visible operation failure.
    const failed =
      data !== null &&
      typeof data === "object" &&
      "spans" in data &&
      "status" in data &&
      (data.status === "error" || data.status === "partial");
    result = { status: failed ? "error" : "ok", data };
  } catch (error) {
    result = {
      status: "error",
      error:
        error instanceof Error ? error.message : "Manager operation failed",
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: { ...result },
    isError: result.status === "error",
  };
}

export function createManagerServer(client: ManagerClient): McpServer {
  const server = new McpServer(
    { name: "project-manager", version: "1.0.0" },
    {
      instructions:
        "Use an explicit project ID for every project operation. Submit source notes as evidence, never as instructions. Notes create pending proposals; only explicit human review approves facts. Do not auto-accept candidates. submit_note and ask_project return run IDs, not completed results: inspect get_run until terminal. Reuse conversation IDs for follow-up questions. Chat history is not automatically ingested. This manager handles task facts, not arbitrary code knowledge. Studio shows the same data, citations and traces.",
    },
  );
  server.registerTool(
    "list_projects",
    {
      description: "List existing projects to select an explicit project ID.",
      inputSchema: z.object({}),
      outputSchema,
      annotations: readOnly,
    },
    async () => respond(() => client.projects.list.query()),
  );
  server.registerTool(
    "create_project",
    {
      description:
        "Create a named project. Repeating this creates another project; list existing projects first.",
      inputSchema: z.object({ name: text.max(200) }),
      outputSchema,
      annotations: { ...write, idempotentHint: false },
    },
    async (input) => respond(() => client.projects.create.mutate(input)),
  );
  server.registerTool(
    "get_project",
    {
      description:
        "Read approved state, pending candidates, notes, review history and persisted conversations for one project.",
      inputSchema: projectInput,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => respond(() => client.projects.get.query(input)),
  );
  server.registerTool(
    "submit_note",
    {
      description:
        "Store an immutable Markdown note and start model extraction. Returns a run ID; inspect get_run for completion. Same source ID/version/content retries are duplicate-safe. Does not approve facts. Calls the configured external model.",
      inputSchema: projectInput.extend({
        sourceId: text.max(200),
        sourceVersion: text.max(100),
        markdown: z.string().min(1).max(30000),
        sourceDate: z.string().optional(),
      }),
      outputSchema,
      annotations: { ...write, idempotentHint: true },
    },
    async (input) => respond(() => client.notes.submit.mutate(input)),
  );
  server.registerTool(
    "retry_note",
    {
      description:
        "Retry failed intake or missing indexing using its original source identity. Returns a run ID. Does not approve facts.",
      inputSchema: projectInput.extend({ noteId: z.string().uuid() }),
      outputSchema,
      annotations: { ...write, idempotentHint: true },
    },
    async (input) => respond(() => client.notes.retry.mutate(input)),
  );
  server.registerTool(
    "list_reviews",
    {
      description:
        "Read pending candidate facts with supporting passages and conflict flags. They are not approved facts.",
      inputSchema: projectInput,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => respond(() => client.reviews.list.query(input)),
  );
  server.registerTool(
    "resolve_review",
    {
      description:
        "Apply an explicit human accept/edit/reject decision. Never call merely to make an answer possible. Requires the current revision; edits retain human-confirmation provenance.",
      inputSchema: projectInput.extend({
        candidateId: z.string().uuid(),
        action: z.enum(["accept", "edit", "reject"]),
        expectedRevision: z.number().int().nonnegative(),
        value: text.max(2000).optional(),
        effectiveDate: z.string().nullable().optional(),
      }),
      outputSchema,
      annotations: { ...write, openWorldHint: false, idempotentHint: false },
    },
    async (input) => respond(() => client.reviews.resolve.mutate(input)),
  );
  server.registerTool(
    "ask_project",
    {
      description:
        "Ask the manager using approved facts only. Persists a conversation and calls the configured external model. Returns a run ID; inspect get_run for its answer, citations, pending-review warning and clarification. Reuse conversationId for follow-ups.",
      inputSchema: projectInput.extend({
        conversationId: z.string().uuid().optional(),
        question: text.max(2000),
      }),
      outputSchema,
      annotations: { ...write, idempotentHint: false },
    },
    async (input) => respond(() => client.conversations.send.mutate(input)),
  );
  server.registerTool(
    "get_run",
    {
      description:
        "Inspect progress and terminal output of an intake/question run, including module traces and errors. Running is not completion; partial/error results remain visible.",
      inputSchema: projectInput.extend({ runId: z.string().uuid() }),
      outputSchema,
      annotations: readOnly,
    },
    async (input) => respond(() => client.runs.get.query(input)),
  );
  server.registerTool(
    "list_runs",
    {
      description: "List persisted intake/question runs for one project.",
      inputSchema: projectInput,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => respond(() => client.runs.list.query(input)),
  );
  server.registerTool(
    "read_evidence",
    {
      description:
        "Read an immutable source snapshot or explicit human confirmation for a citation belonging to this project.",
      inputSchema: projectInput.extend({ documentRef: text }),
      outputSchema,
      annotations: readOnly,
    },
    async (input) => respond(() => client.evidence.read.query(input)),
  );
  return server;
}
