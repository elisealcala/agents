import { config as loadEnvFile } from "dotenv";
import { createModelClient } from "./providers/createClient.ts";
import { AdaptiveIngestPipeline } from "./adaptivePipeline.ts";
import { AuditStore } from "./audit.ts";
import { CorrectionStore } from "./corrections.ts";
import { DocumentStore, backfillDocumentEmbeddings } from "./documents.ts";
import { LocalHashEmbedding } from "./embeddings.ts";
import { runClusteringJob } from "./clustering.ts";
import { getLibraryPaths } from "./taxonomy.ts";

loadEnvFile();

const SMOKE_PROMPT = "Reply with the provider and model id.";

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

async function main(): Promise<void> {
  const [command = "smoke", ...args] = process.argv.slice(2);
  if (command === "run" || command === "watch") {
    const client = createModelClient();
    const configuredThreshold = process.env.INGEST_CATEGORY_DEDUP_THRESHOLD;
    const pipeline = new AdaptiveIngestPipeline({
      root: readRoot(args),
      client,
      dedupThreshold: configuredThreshold ? Number(configuredThreshold) : undefined,
    });
    try {
      if (command === "run") {
        const results = await pipeline.scanOnce();
        console.log(JSON.stringify(results, null, 2));
      } else {
        const controller = new AbortController();
        process.once("SIGINT", () => controller.abort());
        process.once("SIGTERM", () => controller.abort());
        await pipeline.watch(controller.signal);
      }
    } finally {
      pipeline.close();
    }
    return;
  }
  const root = readRoot(args);
  const paths = getLibraryPaths(root);
  if (command === "backfill") {
    const audit = new AuditStore(paths.database);
    const documents = new DocumentStore(paths.database);
    try {
      console.log(
        JSON.stringify(
          await backfillDocumentEmbeddings({
            audit,
            documents,
            embeddingProvider: new LocalHashEmbedding(),
          }),
          null,
          2,
        ),
      );
    } finally {
      documents.close();
      audit.close();
    }
    return;
  }
  if (command === "correct") {
    const corrections = new CorrectionStore(paths.database);
    try {
      console.log(
        JSON.stringify(
          corrections.record({
            originalPath: requireOption(args, "--path"),
            wrongCategory: requireOption(args, "--wrong"),
            correctCategory: requireOption(args, "--correct"),
            note: readOption(args, "--note"),
          }),
          null,
          2,
        ),
      );
    } finally {
      corrections.close();
    }
    return;
  }
  if (command === "cluster") {
    const documents = new DocumentStore(paths.database);
    const outputPath = readOption(args, "--output") ?? `${paths.root}/cluster-suggestions.json`;
    try {
      console.log(
        JSON.stringify(
          await runClusteringJob({ documents, outputPath }),
          null,
          2,
        ),
      );
    } finally {
      documents.close();
    }
    return;
  }
  if (command !== "smoke") {
    throw new Error(
      `Unknown command "${command}". Use smoke, run, watch, backfill, correct, or cluster.`,
    );
  }
  const client = createModelClient();
  const text = await client.complete(SMOKE_PROMPT);
  console.log(
    JSON.stringify(
      { provider: client.provider, model: client.model, text },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
