import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdaptiveIngestPipeline } from "../adaptivePipeline.ts";
import { cosineSimilarity } from "../embeddings.ts";
import { AdaptiveFixtureModelClient } from "./adaptiveFixtureModel.ts";

type Note = readonly [filename: string, content: string];

const SEED_TOPICS = [
  ["project", "# Product roadmap\nRequirements, launch steps, and acceptance criteria."],
  ["architecture", "# API architecture\nDatabase boundaries, cache policy, and TypeScript code."],
  ["meeting", "# Weekly meeting\nAttendees, decisions, and action items."],
  ["ideas", "# Journal idea\nA personal reflection and small creative experiment."],
  ["reference", "# Reading list\nExternal research sources and a reference guide."],
] as const;

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ingest-classifier-m2-"));
  const inbox = path.join(root, "inbox");
  await mkdir(inbox, { recursive: true });

  const firstWave: Note[] = SEED_TOPICS.flatMap(([topic, content]) =>
    Array.from({ length: 8 }, (_, index) => [
      `${topic}-${index + 1}.md`,
      `${content}\nFixture ${index + 1}.`,
    ] as const),
  );
  firstWave.push(
    ["first-bike.md", "# Bicycle maintenance\nTune bike brakes and repair a worn chain."],
    ["first-recipe.md", "# Cooking recipe\nRoast squash with herbs and prepare the ingredients."],
    ["tech-paraphrase.md", "# Dedup candidate\nSoftware design notes that should reuse Architecture & Code."],
  );
  await writeNotes(inbox, firstWave);

  const pipeline = new AdaptiveIngestPipeline({
    root,
    client: new AdaptiveFixtureModelClient(),
  });
  try {
    const firstResults = await pipeline.scanOnce();
    const secondWave: Note[] = [
      ...Array.from({ length: 7 }, (_, index) => [
        `bike-followup-${index + 1}.md`,
        `# Bicycle follow-up ${index + 1}\nBike repair and maintenance checklist.`,
      ] as const),
      ...Array.from({ length: 7 }, (_, index) => [
        `recipe-followup-${index + 1}.md`,
        `# Recipe follow-up ${index + 1}\nCooking technique and ingredient notes.`,
      ] as const),
    ];
    await writeNotes(inbox, secondWave);
    const secondResults = await pipeline.scanOnce();
    const categories = pipeline.categories.list();
    const duplicatePairs: Array<{ left: string; right: string; similarity: number }> = [];
    for (let left = 0; left < categories.length; left += 1) {
      for (let right = left + 1; right < categories.length; right += 1) {
        const a = categories[left]!;
        const b = categories[right]!;
        if (!a.embedding || !b.embedding) continue;
        const similarity = cosineSimilarity(a.embedding, b.embedding);
        if (similarity > pipeline.dedupThreshold) {
          duplicatePairs.push({ left: a.id, right: b.id, similarity });
        }
      }
    }

    const allResults = [...firstResults, ...secondResults];
    const audits = pipeline.audit.list("ok");
    const expectedCategoryIds = [
      "architecture_code",
      "equipment_maintenance",
      "meeting_notes",
      "personal_ideas",
      "project_specs",
      "recipes_cooking",
      "reference_material",
    ];
    const actualCategoryIds = categories.map(({ id }) => id).sort();
    const secondWaveReused = secondResults.every(
      (result) => result.status === "ok" && result.categoryAction === "existing",
    );
    const pass =
      allResults.length === 57 &&
      allResults.every((result) => result.status === "ok") &&
      audits.length === 57 &&
      JSON.stringify(actualCategoryIds) === JSON.stringify(expectedCategoryIds) &&
      duplicatePairs.length === 0 &&
      secondWaveReused;
    console.log(
      JSON.stringify(
        {
          root,
          validMarkdown: allResults.length,
          sorted: allResults.filter((result) => result.status === "ok").length,
          completeAuditRows: audits.length,
          categories: categories.map(({ id, name, definition }) => ({ id, name, definition })),
          duplicatePairs,
          secondWaveReused,
          humanReview: "Expected seven distinct themes: five seeds, equipment maintenance, and recipes/cooking.",
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

async function writeNotes(inbox: string, notes: Note[]): Promise<void> {
  await Promise.all(
    notes.map(([filename, content]) =>
      writeFile(path.join(inbox, filename), content, "utf8"),
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
