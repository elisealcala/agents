import { afterEach, describe, expect, it, vi } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AdaptiveIngestPipeline,
  type AdaptivePipelineOptions,
} from "./adaptivePipeline.ts";
import { cosineSimilarity, type EmbeddingProvider } from "./embeddings.ts";
import { AdaptiveFixtureModelClient } from "./evals/adaptiveFixtureModel.ts";
import type { ModelClient } from "./providers/types.ts";

type Note = readonly [filename: string, content: string];

const pipelines: AdaptiveIngestPipeline[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const pipeline of pipelines.splice(0)) {
    try {
      pipeline.close();
    } catch {
      // A test can close a pipeline before checking persisted state.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "adaptive-pipeline-test-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "inbox"));
  return root;
}

function openPipeline(
  root: string,
  client: ModelClient,
  options: Omit<AdaptivePipelineOptions, "root" | "client"> = {},
): AdaptiveIngestPipeline {
  const pipeline = new AdaptiveIngestPipeline({ root, client, ...options });
  pipelines.push(pipeline);
  return pipeline;
}

function modelClient(complete: ModelClient["complete"]): ModelClient {
  return {
    provider: "openai",
    model: "offline-adaptive-test-model",
    complete,
  };
}

function proposal(
  name: string,
  definition: string,
  tags = ["topic"],
): string {
  return JSON.stringify({
    action: "propose",
    proposal: { name, definition },
    summary: `Summary for ${name}.`,
    tags,
    confidence_score: 0.94,
    fit_score: 0.3,
  });
}

function twoThemeEmbedding(novelMarker: string): EmbeddingProvider {
  return {
    id: "two-theme-fixture-v1",
    dimensions: 2,
    async embed(text: string): Promise<number[]> {
      return text.includes(novelMarker) ? [1, 0] : [0, 1];
    },
  };
}

async function expectMissing(filePath: string): Promise<void> {
  await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("AdaptiveIngestPipeline category lifecycle", () => {
  it("creates and audits a novel category, then reuses it for a related note", async () => {
    const root = await temporaryRoot();
    const inbox = path.join(root, "inbox");
    const firstSource = path.join(inbox, "first-bike.md");
    await writeFile(
      firstSource,
      "# Bicycle maintenance\nTune bike brakes and repair a worn chain.",
      "utf8",
    );
    const pipeline = openPipeline(root, new AdaptiveFixtureModelClient());

    const firstResults = await pipeline.scanOnce();

    expect(firstResults).toEqual([
      expect.objectContaining({
        status: "ok",
        sourcePath: firstSource,
        categoryAction: "created",
        category: expect.objectContaining({
          id: "equipment_maintenance",
          name: "Equipment Maintenance",
          isSeed: false,
        }),
      }),
    ]);
    const category = pipeline.categories.get("equipment_maintenance");
    expect(category).not.toBeNull();
    const folder = pipeline.categories.folderPath(category!);
    expect((await stat(folder)).isDirectory()).toBe(true);
    await expect(readFile(path.join(folder, "first-bike.md"), "utf8")).resolves.toContain(
      "Bicycle maintenance",
    );
    expect(pipeline.audit.findByFilename("first-bike.md")).toEqual([
      expect.objectContaining({
        destinationPath: path.join(folder, "first-bike.md"),
        category: "equipment_maintenance",
        summary: "Offline fixture summary for Equipment Maintenance.",
        status: "ok",
      }),
    ]);

    const secondSource = path.join(inbox, "second-bike.md");
    await writeFile(
      secondSource,
      "# Bike repair follow-up\nA maintenance checklist for brakes and chains.",
      "utf8",
    );
    const secondResults = await pipeline.scanOnce();

    expect(secondResults).toEqual([
      expect.objectContaining({
        status: "ok",
        sourcePath: secondSource,
        categoryAction: "existing",
        category: expect.objectContaining({ id: "equipment_maintenance" }),
      }),
    ]);
    expect(
      pipeline.categories.list().filter(({ id }) => id === "equipment_maintenance"),
    ).toHaveLength(1);
    expect(pipeline.audit.list("ok")).toHaveLength(2);
  });

  it("serializes concurrent duplicate proposals into one create and one merge", async () => {
    const root = await temporaryRoot();
    const inbox = path.join(root, "inbox");
    await Promise.all([
      writeFile(path.join(inbox, "garden-a.md"), "# Garden A\nNovel garden log.", "utf8"),
      writeFile(path.join(inbox, "garden-b.md"), "# Garden B\nNovel garden log.", "utf8"),
    ]);
    const complete = vi.fn<ModelClient["complete"]>(async (_prompt: string) =>
      proposal(
        "Garden Logs",
        "Seasonal observations and maintenance notes for a home garden.",
        ["garden"],
      ),
    );
    const pipeline = openPipeline(root, modelClient(complete), {
      embeddingProvider: twoThemeEmbedding("Garden Logs"),
    });

    const results = await pipeline.scanOnce();

    expect(results).toHaveLength(2);
    expect(results.every(({ status }) => status === "ok")).toBe(true);
    expect(
      results
        .filter((result) => result.status === "ok")
        .map(({ categoryAction }) => categoryAction)
        .sort(),
    ).toEqual(["created", "merged"]);
    expect(
      pipeline.categories.list().filter(({ id }) => id.startsWith("garden_logs")),
    ).toEqual([expect.objectContaining({ id: "garden_logs", isSeed: false })]);
    await expect(readdir(path.join(root, "library", "garden-logs"))).resolves.toEqual(
      expect.arrayContaining(["garden-a.md", "garden-b.md"]),
    );
    expect(complete).toHaveBeenCalledTimes(2);
    expect(pipeline.audit.list("ok")).toHaveLength(2);
  });

  it("retains the category row and source when verified movement fails", async () => {
    const root = await temporaryRoot();
    const inbox = path.join(root, "inbox");
    const sourcePath = path.join(inbox, "fragile.md");
    await writeFile(sourcePath, "# Fragile\nOriginal bytes at parse time.", "utf8");
    const pipeline = openPipeline(
      root,
      modelClient(
        vi.fn(async () =>
          proposal(
            "Fragile Topic",
            "A novel topic used to exercise move compensation.",
            ["fragile"],
          ),
        ),
      ),
      { embeddingProvider: twoThemeEmbedding("Fragile Topic") },
    );
    const originalCreate = pipeline.categories.create.bind(pipeline.categories);
    vi.spyOn(pipeline.categories, "create").mockImplementation(async (...args) => {
      const category = await originalCreate(...args);
      await writeFile(sourcePath, "Changed after parse, before verified move.", "utf8");
      return category;
    });

    const results = await pipeline.scanOnce();

    expect(results).toEqual([
      {
        status: "failed",
        sourcePath,
        error: "destination verification failed",
      },
    ]);
    await expect(readFile(sourcePath, "utf8")).resolves.toBe(
      "Changed after parse, before verified move.",
    );
    const category = pipeline.categories.get("fragile_topic");
    expect(category).not.toBeNull();
    const folder = pipeline.categories.folderPath(category!);
    expect((await stat(folder)).isDirectory()).toBe(true);
    await expect(readdir(folder)).resolves.toEqual([]);
    await expectMissing(path.join(folder, "fragile.md"));
    expect(pipeline.audit.findByFilename("fragile.md")).toEqual([
      expect.objectContaining({
        category: "fragile_topic",
        destinationPath: null,
        status: "failed",
        error: "destination verification failed",
      }),
    ]);
  });
});

describe("M2 adaptive exit gate", () => {
  it("sorts 50+ notes into distinct themes without duplicate category vectors", async () => {
    const root = await temporaryRoot();
    const inbox = path.join(root, "inbox");
    const seedTopics = [
      ["project", "# Product roadmap\nRequirements, launch steps, and acceptance criteria."],
      ["architecture", "# API architecture\nDatabase boundaries, cache policy, and code."],
      ["meeting", "# Weekly meeting\nAttendees, decisions, and minutes."],
      ["ideas", "# Journal idea\nA reflection and creative experiment."],
      ["reference", "# Reading list\nExternal research sources and a reference guide."],
    ] as const;
    const firstWave: Note[] = seedTopics.flatMap(([topic, content]) =>
      Array.from({ length: 8 }, (_, index) => [
        `${topic}-${index + 1}.md`,
        `${content}\nFixture ${index + 1}.`,
      ] as const),
    );
    firstWave.push(
      ["first-bike.md", "# Bicycle maintenance\nTune bike brakes and repair a worn chain."],
      ["first-recipe.md", "# Cooking recipe\nRoast squash and prepare the ingredients."],
      ["tech-paraphrase.md", "# Dedup candidate\nSoftware design should reuse Architecture & Code."],
    );
    await Promise.all(
      firstWave.map(([filename, content]) =>
        writeFile(path.join(inbox, filename), content, "utf8"),
      ),
    );
    const pipeline = openPipeline(root, new AdaptiveFixtureModelClient());

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
    await Promise.all(
      secondWave.map(([filename, content]) =>
        writeFile(path.join(inbox, filename), content, "utf8"),
      ),
    );
    const secondResults = await pipeline.scanOnce();

    const allResults = [...firstResults, ...secondResults];
    expect(allResults).toHaveLength(57);
    expect(allResults.every(({ status }) => status === "ok")).toBe(true);
    expect(
      firstResults
        .filter((result) => result.status === "ok")
        .filter(({ categoryAction }) => categoryAction === "created"),
    ).toHaveLength(2);
    expect(
      firstResults
        .filter((result) => result.status === "ok")
        .filter(({ categoryAction }) => categoryAction === "merged"),
    ).toHaveLength(1);
    expect(
      secondResults.every(
        (result) => result.status === "ok" && result.categoryAction === "existing",
      ),
    ).toBe(true);
    await expect(readdir(inbox)).resolves.toEqual([]);
    expect(pipeline.audit.list("ok")).toHaveLength(57);

    const categories = pipeline.categories.list();
    expect(categories.map(({ id }) => id).sort()).toEqual([
      "architecture_code",
      "equipment_maintenance",
      "meeting_notes",
      "personal_ideas",
      "project_specs",
      "recipes_cooking",
      "reference_material",
    ]);
    for (let left = 0; left < categories.length; left += 1) {
      for (let right = left + 1; right < categories.length; right += 1) {
        const a = categories[left]!;
        const b = categories[right]!;
        expect(a.embedding).not.toBeNull();
        expect(b.embedding).not.toBeNull();
        expect(cosineSimilarity(a.embedding!, b.embedding!)).toBeLessThanOrEqual(
          pipeline.dedupThreshold,
        );
      }
    }
  });
});
