import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdaptiveIngestPipeline } from "../adaptivePipeline.ts";
import { runClusteringJob } from "../clustering.ts";
import { answerQuestion } from "../retrieval.ts";
import { AdaptiveFixtureModelClient } from "./adaptiveFixtureModel.ts";

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ingest-classifier-m3-"));
  const inbox = path.join(root, "inbox");
  await mkdir(inbox, { recursive: true });
  const notes = [
    ...Array.from({ length: 6 }, (_, index) => [
      `q3-cache-${index + 1}.md`,
      `# Q3 caching strategy ${index + 1}\nArchitecture review: measure Redis cache hit rate, choose explicit TTL values, and rehearse cache invalidation before the Q3 rollout.`,
    ] as const),
    ...Array.from({ length: 6 }, (_, index) => [
      `auth-${index + 1}.md`,
      `# Authentication architecture ${index + 1}\nAPI code should rotate OAuth tokens, validate sessions, and keep authorization permissions separate.`,
    ] as const),
  ];
  await Promise.all(
    notes.map(([filename, content]) => writeFile(path.join(inbox, filename), content, "utf8")),
  );

  const client = new AdaptiveFixtureModelClient();
  const pipeline = new AdaptiveIngestPipeline({ root, client });
  try {
    const processed = await pipeline.scanOnce();
    const correction = pipeline.corrections.record({
      originalPath: processed[0]?.status === "ok" ? processed[0].destinationPath : "fixture.md",
      wrongCategory: "architecture_code",
      correctCategory: "meeting_notes",
      note: "Treat retrospective action-item notes as meetings in future runs.",
    });
    const outputPath = path.join(root, "cluster-suggestions.json");
    const clustering = await runClusteringJob({
      documents: pipeline.documents,
      outputPath,
      minimumCategorySize: 6,
    });
    await access(outputPath);
    for (const result of processed) {
      if (result.status === "ok") await access(result.destinationPath);
    }

    const answer = await answerQuestion({
      question: "What were the key takeaways from the Q3 caching strategy?",
      documents: pipeline.documents,
      embeddingProvider: pipeline.embeddingProvider,
      model: client,
      topK: 4,
    });
    const architectureSplit = clustering.suggestions.find(
      ({ categoryId }) => categoryId === "architecture_code",
    );
    const pass =
      processed.length === notes.length &&
      processed.every((result) => result.status === "ok") &&
      pipeline.documents.list("ready").length === notes.length &&
      Boolean(architectureSplit) &&
      answer.sources.length > 0 &&
      answer.sources.every(({ path: sourcePath }) => sourcePath.includes("q3-cache")) &&
      answer.sources.every(({ path: sourcePath }) => answer.answer.includes(sourcePath)) &&
      pipeline.corrections.listRecent().some(({ id }) => id === correction.id);
    console.log(
      JSON.stringify(
        {
          root,
          sorted: processed.filter(({ status }) => status === "ok").length,
          readyDocumentEmbeddings: pipeline.documents.list("ready").length,
          correction,
          clustering,
          answer,
          filesRemainInPlaceAfterClustering: true,
          pass,
        },
        null,
        2,
      ),
    );
    if (!pass) process.exitCode = 1;
  } finally {
    pipeline.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
