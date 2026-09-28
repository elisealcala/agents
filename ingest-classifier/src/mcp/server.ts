/**
 * The six MCP tools, mapped onto the shared application operations (DEC-017).
 *
 * This module only adapts: every tool validates through the same contracts the
 * CLI uses and adds no behavior of its own. Tool descriptions state side
 * effects explicitly, because a supervisor chooses tools by reading them.
 */
import { McpServer } from "@modelcontextprotocol/server";
import type { IngestAgent } from "../application/agent.ts";
import {
  emptyInputSchema,
  questionInputSchema,
  correctionInputSchema,
  clusterInputSchema,
  ingestReportSchema,
  searchReportSchema,
  answerSchema,
  correctionSchema,
  clusteringReportSchema,
  backfillReportSchema,
  resultSchema,
  type OperationResult,
} from "../application/contracts.ts";

/**
 * Wrap an operation result as an MCP tool response.
 *
 * `isError` is set for anything other than a full success, including
 * `partial`, so a host cannot mistake a half-finished batch for a clean run.
 * The payload is sent both as text and as structured content.
 */
function toolResult(result: OperationResult<unknown>): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: OperationResult<unknown>;
  isError: boolean;
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: { ...result },
    isError: result.status !== "success",
  };
}

/** Register every tool against one agent bound to one library. */
export function createClassifierServer(agent: IngestAgent): McpServer {
  const server = new McpServer({ name: "ingest-classifier", version: "1.0.0" });
  server.registerTool(
    "ingest_inbox",
    {
      description:
        "Classify and file one batch from the configured library inbox. Moves files and updates taxonomy/audit data. Inspect all file results before retrying; a partial result may already have moved files. Returns LIBRARY_BUSY if another ingestion run or watcher owns the library.",
      inputSchema: emptyInputSchema,
      outputSchema: resultSchema(ingestReportSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => toolResult(await agent.ingestInbox(input)),
  );
  server.registerTool(
    "search_documents",
    {
      description:
        "Search stored document vectors in the configured library and return paths, summaries, scores, and snippets. No model completion or external embedding call.",
      inputSchema: questionInputSchema,
      outputSchema: resultSchema(searchReportSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => toolResult(await agent.searchDocuments(input)),
  );
  server.registerTool(
    "ask_question",
    {
      description:
        "Answer a question using retrieved library excerpts and the configured model. Returns citations, or an explicit no-sources answer when nothing relevant is found.",
      inputSchema: questionInputSchema,
      outputSchema: resultSchema(answerSchema),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => toolResult(await agent.askQuestion(input)),
  );
  server.registerTool(
    "suggest_category_splits",
    {
      description:
        "Suggest category splits using stored document vectors. Returns a report only; never moves files, applies changes, or writes a report file.",
      inputSchema: clusterInputSchema,
      outputSchema: resultSchema(clusteringReportSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => toolResult(await agent.suggestCategorySplits(input)),
  );
  server.registerTool(
    "record_correction",
    {
      description:
        "Record human classification feedback for future prompts. Saves feedback only; does not move or reclassify the existing file. Repeating the call creates another correction.",
      inputSchema: correctionInputSchema,
      outputSchema: resultSchema(correctionSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => toolResult(await agent.recordCorrection(input)),
  );
  server.registerTool(
    "backfill_embeddings",
    {
      description:
        "Repair missing document embeddings using local files and the local embedding provider. Updates document storage and returns counts, including failures.",
      inputSchema: emptyInputSchema,
      outputSchema: resultSchema(backfillReportSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => toolResult(await agent.backfillEmbeddings(input)),
  );
  return server;
}
