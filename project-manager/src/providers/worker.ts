/** Typed client of the dedicated classifier evidence process; no shared database writes. */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "ingest-classifier/server";
import type { Worker } from "../application/contracts.ts";

export function createWorker(url: string): Worker {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url,
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(120000) }),
      }),
    ],
  });
  return {
    identity: () => client.agent.identity.query(),
    async ingest(input) {
      const result = await client.evidence.ingest.mutate(input);
      if (!result.data || result.status === "error")
        throw new Error(
          result.error?.message ?? "Evidence intake returned no receipt",
        );
      return result.data;
    },
    async read(projectId, documentRef) {
      const result = await client.evidence.read.query({
        projectId,
        documentRef,
      });
      if (result.status !== "success") throw new Error(result.error.message);
      return result.data;
    },
    async search(projectId, question, topK) {
      const result = await client.evidence.search.query({
        projectId,
        question,
        topK,
      });
      if (!result.data || result.status === "error")
        throw new Error(result.error?.message ?? "Evidence search failed");
      return result.data;
    },
  };
}
