import { afterEach, describe, expect, it, vi } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelClient } from "./providers/types.ts";
import { IngestPipeline } from "./pipeline.ts";
import {
  SEED_CATEGORIES,
  type SeedCategoryId,
} from "./taxonomy.ts";

const pipelines: IngestPipeline[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const pipeline of pipelines.splice(0)) {
    try {
      pipeline.close();
    } catch {
      // A test may close its store while checking persistence behavior.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pipeline-test-"));
  temporaryDirectories.push(root);
  return root;
}

function createPipeline(
  root: string,
  complete: ModelClient["complete"],
  pollIntervalMs = 1_000,
): IngestPipeline {
  const pipeline = new IngestPipeline({
    root,
    pollIntervalMs,
    client: {
      provider: "openai",
      model: "offline-test-model",
      complete,
    },
  });
  pipelines.push(pipeline);
  return pipeline;
}

function response(
  category: SeedCategoryId = "project_specs",
  confidence_score = 0.9,
): string {
  return JSON.stringify({
    category,
    summary: `Summary for ${category}.`,
    tags: [category],
    confidence_score,
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, milliseconds = 1_000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`timed out after ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function expectMissing(filePath: string): Promise<void> {
  await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("IngestPipeline scanning", () => {
  it("classifies concurrently detected Markdown files and does not process them twice", async () => {
    const root = await createRoot();
    const inbox = path.join(root, "inbox");
    await mkdir(inbox);
    const originals = new Map<string, Buffer>([
      ["alpha.md", Buffer.from("# Alpha\nFirst project requirement.")],
      ["beta.md", Buffer.from("# Beta\nSecond project requirement.")],
      ["UPPER.MD", Buffer.from("# Upper\nAn uppercase extension still works.")],
    ]);
    await Promise.all(
      [...originals].map(([filename, bytes]) =>
        writeFile(path.join(inbox, filename), bytes),
      ),
    );
    let active = 0;
    let maximumActive = 0;
    const complete = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return response();
    });
    const pipeline = createPipeline(root, complete);

    const results = await pipeline.scanOnce();

    expect(results).toHaveLength(3);
    expect(results.every(({ status }) => status === "ok")).toBe(true);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(maximumActive).toBeGreaterThan(1);
    expect(pipeline.audit.list("ok")).toHaveLength(3);
    for (const [filename, bytes] of originals) {
      const destination = path.join(
        pipeline.paths.categories.project_specs,
        filename,
      );
      expect((await readFile(destination)).equals(bytes)).toBe(true);
      await expectMissing(path.join(inbox, filename));
    }

    await expect(pipeline.scanOnce()).resolves.toEqual([]);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(pipeline.audit.list()).toHaveLength(3);
  });

  it("allows only one of two overlapping scans to process the same path", async () => {
    const root = await createRoot();
    const inbox = path.join(root, "inbox");
    await mkdir(inbox);
    await writeFile(path.join(inbox, "race.md"), "# Race\nOne copy only.", "utf8");
    const enteredClassifier = deferred();
    const releaseClassifier = deferred();
    const complete = vi.fn(async () => {
      enteredClassifier.resolve();
      await releaseClassifier.promise;
      return response("architecture_code");
    });
    const pipeline = createPipeline(root, complete);

    const firstScan = pipeline.scanOnce();
    await withTimeout(enteredClassifier.promise);
    const secondResults = await withTimeout(pipeline.scanOnce()).finally(() => {
      releaseClassifier.resolve();
    });
    const firstResults = await firstScan;
    const allResults = [...firstResults, ...secondResults];

    expect(allResults).toHaveLength(2);
    expect(allResults.filter(({ status }) => status === "ok")).toHaveLength(1);
    expect(allResults).toContainEqual(
      expect.objectContaining({ status: "skipped", reason: "already processing" }),
    );
    expect(complete).toHaveBeenCalledOnce();
    expect(pipeline.audit.list("ok")).toHaveLength(1);
  });

  it("leaves non-Markdown files in place and audits each unchanged file once", async () => {
    const root = await createRoot();
    const inbox = path.join(root, "inbox");
    await mkdir(inbox);
    const ignoredPath = path.join(inbox, "diagram.png");
    await writeFile(ignoredPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const complete = vi.fn(async () => response());
    const pipeline = createPipeline(root, complete);

    await expect(pipeline.scanOnce()).resolves.toEqual([
      { status: "skipped", sourcePath: ignoredPath, reason: "non-Markdown file" },
    ]);
    await expect(pipeline.scanOnce()).resolves.toEqual([
      { status: "skipped", sourcePath: ignoredPath, reason: "non-Markdown file" },
    ]);

    await expect(readFile(ignoredPath)).resolves.toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(pipeline.audit.list("skipped")).toEqual([
      expect.objectContaining({
        sourcePath: ignoredPath,
        status: "skipped",
        error: "non-Markdown file",
      }),
    ]);
  });

  it("keeps invalid UTF-8 Markdown untouched and audits the parse failure", async () => {
    const root = await createRoot();
    const inbox = path.join(root, "inbox");
    await mkdir(inbox);
    const sourcePath = path.join(inbox, "invalid.md");
    const bytes = Buffer.from([0xc3, 0x28]);
    await writeFile(sourcePath, bytes);
    const complete = vi.fn(async () => response());
    const pipeline = createPipeline(root, complete);

    const results = await pipeline.scanOnce();

    expect(results).toEqual([
      expect.objectContaining({ status: "failed", sourcePath }),
    ]);
    expect((await readFile(sourcePath)).equals(bytes)).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(pipeline.audit.list("failed")).toEqual([
      expect.objectContaining({
        sourcePath,
        sourceSha256: "unavailable",
        category: null,
        status: "failed",
      }),
    ]);
  });

  it("rescans an unchanged parse failure without duplicating or escaping the audit error", async () => {
    const root = await createRoot();
    const inbox = path.join(root, "inbox");
    await mkdir(inbox);
    const sourcePath = path.join(inbox, "repeat-invalid.md");
    const bytes = Buffer.from([0xc3, 0x28]);
    await writeFile(sourcePath, bytes);
    const complete = vi.fn(async () => response());
    const pipeline = createPipeline(root, complete);

    const first = await pipeline.scanOnce();
    const second = await pipeline.scanOnce();

    expect(first).toEqual([
      expect.objectContaining({ status: "failed", sourcePath }),
    ]);
    expect(second).toEqual([
      expect.objectContaining({ status: "failed", sourcePath }),
    ]);
    expect((await readFile(sourcePath)).equals(bytes)).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(pipeline.audit.list("failed")).toEqual([
      expect.objectContaining({
        sourcePath,
        sourceSha256: "unavailable",
        status: "failed",
      }),
    ]);
  });

  it("keeps a note untouched when both classification replies fail schema validation", async () => {
    const root = await createRoot();
    const inbox = path.join(root, "inbox");
    await mkdir(inbox);
    const sourcePath = path.join(inbox, "bad-reply.md");
    await writeFile(sourcePath, "# Valid source\nNever discard this.", "utf8");
    const complete = vi.fn(async () => "not-json");
    const pipeline = createPipeline(root, complete);

    const results = await pipeline.scanOnce();

    expect(results).toEqual([
      expect.objectContaining({
        status: "failed",
        sourcePath,
        error: expect.stringContaining("after 2 attempts"),
      }),
    ]);
    await expect(readFile(sourcePath, "utf8")).resolves.toContain("Never discard this");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(pipeline.audit.list("failed")).toEqual([
      expect.objectContaining({
        sourcePath,
        category: null,
        destinationPath: null,
        status: "failed",
      }),
    ]);
  });

  it("uses a collision suffix without changing an existing library file", async () => {
    const root = await createRoot();
    const pipeline = createPipeline(root, vi.fn(async () => response("meeting_notes")));
    await pipeline.initialize();
    const sourcePath = path.join(pipeline.paths.inbox, "notes.md");
    const existingPath = path.join(pipeline.paths.categories.meeting_notes, "notes.md");
    await writeFile(sourcePath, "new meeting notes", "utf8");
    await writeFile(existingPath, "existing meeting notes", "utf8");

    await expect(pipeline.scanOnce()).resolves.toEqual([
      expect.objectContaining({
        status: "ok",
        destinationPath: path.join(
          pipeline.paths.categories.meeting_notes,
          "notes-2.md",
        ),
      }),
    ]);
    await expect(readFile(existingPath, "utf8")).resolves.toBe(
      "existing meeting notes",
    );
    await expect(
      readFile(path.join(pipeline.paths.categories.meeting_notes, "notes-2.md"), "utf8"),
    ).resolves.toBe("new meeting notes");
  });

  it("restores the inbox source if audit finalization fails after the move", async () => {
    const root = await createRoot();
    const pipeline = createPipeline(
      root,
      vi.fn(async () => response("reference_material")),
    );
    await pipeline.initialize();
    const sourcePath = path.join(pipeline.paths.inbox, "recover.md");
    const destinationPath = path.join(
      pipeline.paths.categories.reference_material,
      "recover.md",
    );
    await writeFile(sourcePath, "restore after database failure", "utf8");
    vi.spyOn(pipeline.audit, "setDestination").mockImplementationOnce(() => {
      throw new Error("database write failed");
    });

    await expect(pipeline.scanOnce()).resolves.toEqual([
      {
        status: "failed",
        sourcePath,
        error: "database write failed",
      },
    ]);
    await expect(readFile(sourcePath, "utf8")).resolves.toBe(
      "restore after database failure",
    );
    await expectMissing(destinationPath);
    expect(pipeline.audit.list("failed")).toEqual([
      expect.objectContaining({
        sourcePath,
        destinationPath: null,
        status: "failed",
        error: "database write failed",
      }),
    ]);
  });
});

describe("IngestPipeline polling", () => {
  it("detects a Markdown file added after the initial watch scan", async () => {
    const root = await createRoot();
    const observedClassification = deferred();
    const complete = vi.fn(async () => {
      observedClassification.resolve();
      return response("personal_ideas");
    });
    const pipeline = createPipeline(root, complete, 5);
    const initialScanFinished = deferred();
    const originalScanOnce = pipeline.scanOnce.bind(pipeline);
    let scanCount = 0;
    vi.spyOn(pipeline, "scanOnce").mockImplementation(async () => {
      const results = await originalScanOnce();
      scanCount += 1;
      if (scanCount === 1) initialScanFinished.resolve();
      return results;
    });
    const controller = new AbortController();
    const watch = pipeline.watch(controller.signal);

    try {
      await withTimeout(initialScanFinished.promise);
      await writeFile(
        path.join(pipeline.paths.inbox, "arrived-later.md"),
        "# Idea\nCreated after watch started.",
        "utf8",
      );
      await withTimeout(observedClassification.promise);
    } finally {
      controller.abort();
      await withTimeout(watch);
    }

    expect(scanCount).toBeGreaterThanOrEqual(2);
    expect(complete).toHaveBeenCalledOnce();
    await expect(
      readFile(
        path.join(pipeline.paths.categories.personal_ideas, "arrived-later.md"),
        "utf8",
      ),
    ).resolves.toContain("Created after watch started");
  });
});

describe("M1 exit gate", () => {
  it("sorts 20 valid notes with original bytes and complete audit metadata", async () => {
    const root = await createRoot();
    const inbox = path.join(root, "inbox");
    await mkdir(inbox);
    const originals = new Map<string, { bytes: Buffer; category: SeedCategoryId }>();
    for (const category of SEED_CATEGORIES.map(({ id }) => id)) {
      for (let index = 1; index <= 4; index += 1) {
        const filename = `${category}-${index}.md`;
        const bytes = Buffer.from(
          `---\nfixture: ${index}\n---\n# Note ${index}\nTarget category: ${category}\nPreserve **these** bytes.\n`,
        );
        originals.set(filename, { bytes, category });
        await writeFile(path.join(inbox, filename), bytes);
      }
    }
    const complete = vi.fn(async (prompt: string) => {
      const match = prompt.match(
        /Target category: (project_specs|architecture_code|meeting_notes|personal_ideas|reference_material)/,
      );
      if (!match) throw new Error("fixture category marker missing");
      return response(match[1] as SeedCategoryId, 0.95);
    });
    const pipeline = createPipeline(root, complete);

    const results = await pipeline.scanOnce();

    expect(results).toHaveLength(20);
    expect(results.every(({ status }) => status === "ok")).toBe(true);
    expect(complete).toHaveBeenCalledTimes(20);
    await expect(readdir(inbox)).resolves.toEqual([]);

    const audits = pipeline.audit.list("ok");
    expect(audits).toHaveLength(20);
    for (const [filename, { bytes, category }] of originals) {
      const destinationPath = path.join(pipeline.paths.categories[category], filename);
      expect((await readFile(destinationPath)).equals(bytes)).toBe(true);
      expect(pipeline.audit.findByFilename(filename)).toEqual([
        expect.objectContaining({
          destinationPath,
          category,
          summary: `Summary for ${category}.`,
          tags: [category],
          confidence: 0.95,
          provider: "openai",
          model: "offline-test-model",
          status: "ok",
          error: null,
        }),
      ]);
    }
  });
});
