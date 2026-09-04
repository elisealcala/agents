import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdaptiveIngestPipeline } from "../adaptivePipeline.ts";
import { runClusteringJob } from "../clustering.ts";
import { answerQuestion } from "../retrieval.ts";
import { AdaptiveFixtureModelClient } from "./adaptiveFixtureModel.ts";

const pipelines: AdaptiveIngestPipeline[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const pipeline of pipelines.splice(0)) {
    try {
      pipeline.close();
    } catch {
      // A test may already have closed the pipeline.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("M3 offline workflow", () => {
  it("stores documents, learns a correction, suggests without moving, and answers with citations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "m3-workflow-test-"));
    temporaryDirectories.push(root);
    const inbox = path.join(root, "inbox");
    await mkdir(inbox);
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
      notes.map(([filename, content]) =>
        writeFile(path.join(inbox, filename), content, "utf8"),
      ),
    );
    const client = new AdaptiveFixtureModelClient();
    const pipeline = new AdaptiveIngestPipeline({ root, client });
    pipelines.push(pipeline);

    const processed = await pipeline.scanOnce();

    expect(processed).toHaveLength(12);
    expect(processed.every(({ status }) => status === "ok")).toBe(true);
    expect(pipeline.documents.list("ready")).toHaveLength(12);
    expect(pipeline.documents.list("missing")).toEqual([]);
    const destinations = processed.flatMap((result) =>
      result.status === "ok" ? [result.destinationPath] : [],
    );
    const bytesBefore = new Map(
      await Promise.all(
        destinations.map(async (destinationPath) => [
          destinationPath,
          await readFile(destinationPath),
        ] as const),
      ),
    );
    const correction = pipeline.corrections.record({
      originalPath: destinations[0]!,
      wrongCategory: "architecture_code",
      correctCategory: "meeting_notes",
      note: "Retrospective action items should be treated as meeting notes.",
    });
    const outputPath = path.join(root, "cluster-suggestions.json");

    const clustering = await runClusteringJob({
      documents: pipeline.documents,
      outputPath,
      minimumCategorySize: 6,
    });
    const answer = await answerQuestion({
      question: "What were the key takeaways from the Q3 caching strategy?",
      documents: pipeline.documents,
      embeddingProvider: pipeline.embeddingProvider,
      model: client,
      topK: 4,
    });

    expect(pipeline.corrections.get(correction.id)).toEqual(correction);
    expect(pipeline.corrections.toPromptExamples()).toContain(
      `File ${destinations[0]!} was incorrectly classified as architecture_code; use meeting_notes. Note: Retrospective action items should be treated as meeting notes.`,
    );
    const architectureSplit = clustering.suggestions.find(
      ({ categoryId }) => categoryId === "architecture_code",
    );
    expect(architectureSplit).toEqual(
      expect.objectContaining({
        action: "split",
        categoryId: "architecture_code",
        clusters: [
          expect.objectContaining({ documentCount: 6 }),
          expect.objectContaining({ documentCount: 6 }),
        ],
      }),
    );
    expect(
      JSON.parse(await readFile(outputPath, "utf8")),
    ).toEqual(clustering);
    for (const [destinationPath, bytes] of bytesBefore) {
      await expect(access(destinationPath)).resolves.toBeUndefined();
      expect((await readFile(destinationPath)).equals(bytes)).toBe(true);
    }
    expect(answer.answer).toContain(
      "measuring cache hit rate, choosing explicit TTLs, and rehearsing invalidation",
    );
    expect(answer.sources).toHaveLength(4);
    expect(answer.sources.every(({ path: sourcePath }) => sourcePath.includes("q3-cache")))
      .toBe(true);
    for (const source of answer.sources) {
      expect(destinations).toContain(source.path);
      expect(answer.answer).toContain(`- ${source.path}`);
      expect(source.snippet).toContain("Q3 caching strategy");
    }
  });
});
