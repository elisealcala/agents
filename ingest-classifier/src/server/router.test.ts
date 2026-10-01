import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAnthropicProvider } from "../providers/anthropic.ts";
import type { MessagesPort } from "../providers/anthropic.ts";
import { getLibraryPaths } from "../taxonomy/taxonomy.ts";
import { StudioStore } from "../storage/studio.ts";
import { createStudioCaller, type StudioContext } from "./router.ts";

const directories: string[] = [];
const stores: StudioStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function filingModel(): ReturnType<typeof createAnthropicProvider> {
  const port: MessagesPort = {
    messages: {
      create: async () => ({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "list", name: "list_categories", input: {} },
          {
            type: "tool_use",
            id: "file",
            name: "file_existing",
            input: {
              category: "project_specs",
              summary: "A product requirement.",
              tags: ["planning"],
              confidence_score: 0.9,
              fit_score: 0.91,
            },
          },
        ],
      }),
    },
  };
  return createAnthropicProvider({
    apiKey: "test",
    model: "fixture",
    client: port,
  });
}

async function context(): Promise<StudioContext> {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-router-"));
  directories.push(root);
  const store = new StudioStore(getLibraryPaths(root).database);
  stores.push(store);
  return {
    root,
    store,
    createModel: () => filingModel(),
  };
}

describe("studio router", () => {
  it("returns built-in config and rejects a template that drops a slot", async () => {
    const caller = createStudioCaller(await context());
    const config = await caller.config.get();
    expect(config.fitThreshold).toBe(0.8);
    expect(config.promptTemplate).toContain("{{fit_threshold}}");
    expect(config.promptTemplate).toContain("{{examples}}");

    await expect(
      caller.config.update({
        ...config,
        promptTemplate: "Classify the note.",
      }),
    ).rejects.toThrow(/{{fit_threshold}}/);

    const saved = await caller.config.update({
      fitThreshold: 0.9,
      dedupThreshold: 0.9,
      exampleLimit: 2,
      promptTemplate: config.defaults.promptTemplate,
    });
    expect(saved.fitThreshold).toBe(0.9);
    expect((await caller.config.get()).exampleLimit).toBe(2);
  });

  it("lists categories and records then deletes a correction", async () => {
    const caller = createStudioCaller(await context());
    const categories = await caller.memory.categories();
    expect(categories.map((category) => category.id)).toContain(
      "project_specs",
    );
    expect(categories[0]).not.toHaveProperty("embedding");

    const recorded = await caller.corrections.record({
      originalPath: "inbox/note.md",
      wrongCategory: "project_specs",
      correctCategory: "meeting_notes",
      note: "This was a meeting.",
    });
    expect(recorded.status).toBe("success");
    const listed = await caller.corrections.list();
    expect(listed).toHaveLength(1);
    await caller.corrections.delete({ id: listed[0]!.id });
    expect(await caller.corrections.list()).toHaveLength(0);
  });

  it("runs an ingest and keeps organizer tool calls in the trace", async () => {
    const ctx = await context();
    const caller = createStudioCaller(ctx);
    const inbox = getLibraryPaths(ctx.root).inbox;
    await mkdir(inbox, { recursive: true });
    await writeFile(
      path.join(inbox, "spec.md"),
      "# Cache\n\nUse an explicit TTL.\n",
      "utf8",
    );

    const started = await caller.runs.start({ action: "ingest_inbox" });
    await vi.waitFor(
      async () => {
        const run = await caller.runs.get({ runId: started.runId });
        expect(run.status).not.toBe("running");
      },
      { timeout: 5_000 },
    );

    const run = await caller.runs.get({ runId: started.runId });
    expect(run.status).toBe("success");
    const names = run.spans.map((span) => span.name);
    expect(names).toContain("ingest_inbox");
    expect(names).toContain("list_categories");
    expect(names).toContain("file_existing");
    const filed = run.spans.find((span) => span.name === "file_existing");
    expect(filed?.kind).toBe("tool");
    expect(filed?.status).toBe("ok");
    expect(filed?.output).toMatchObject({ terminal: true });

    const followed = [];
    for await (const span of await caller.runs.follow({
      runId: started.runId,
    })) {
      followed.push(span);
    }
    expect(followed.map((span) => span.name)).toEqual(names);
  });
});
