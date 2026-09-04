import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CategoryStore, categoryText } from "./categories.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import { SEED_CATEGORIES } from "./taxonomy.ts";

const stores: CategoryStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // A restart test may already have closed this connection.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "categories-test-"));
  temporaryDirectories.push(root);
  return root;
}

function openStore(root: string): CategoryStore {
  const store = new CategoryStore(
    path.join(root, "ingest-classifier.sqlite"),
    root,
  );
  stores.push(store);
  return store;
}

function provider(
  id = "fixture-v1",
  dimensions = 3,
) {
  const embed = vi.fn<EmbeddingProvider["embed"]>(async (text: string) => {
    const length = text.length || 1;
    return Array.from({ length: dimensions }, (_, index) =>
      index === 0 ? 1 : (length + index) / 1_000,
    );
  });
  return { id, dimensions, embed };
}

async function expectDirectory(directory: string): Promise<void> {
  expect((await stat(directory)).isDirectory()).toBe(true);
}

describe("CategoryStore migrations and initialization", () => {
  it("migrates an existing M1 SQLite database and seeds the live taxonomy idempotently", async () => {
    const root = await temporaryRoot();
    const databasePath = path.join(root, "ingest-classifier.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      "CREATE TABLE legacy_m1_state (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO legacy_m1_state (value) VALUES ('preserved');",
    );
    legacy.close();

    const first = openStore(root);
    const firstCategories = first.list();

    expect(firstCategories).toHaveLength(SEED_CATEGORIES.length);
    expect(firstCategories.map(({ id }) => id).sort()).toEqual(
      SEED_CATEGORIES.map(({ id }) => id).sort(),
    );
    expect(
      firstCategories.every(
        ({ isSeed, embedding, embeddingProvider }) =>
          isSeed && embedding === null && embeddingProvider === null,
      ),
    ).toBe(true);
    first.close();

    const restarted = openStore(root);
    expect(restarted.list()).toHaveLength(SEED_CATEGORIES.length);
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const legacyRow = inspection
      .prepare("SELECT value FROM legacy_m1_state")
      .get() as { value: string };
    inspection.close();
    expect(legacyRow.value).toBe("preserved");
  });

  it("creates the library folder for every persisted category", async () => {
    const root = await temporaryRoot();
    const store = openStore(root);

    await store.initialize();

    for (const category of store.list()) {
      await expectDirectory(store.folderPath(category));
      expect(store.folderPath(category)).toBe(
        path.join(root, "library", category.folder),
      );
    }
  });
});

describe("CategoryStore dynamic categories", () => {
  it("creates slugged rows and folders without overwriting a duplicate name", async () => {
    const root = await temporaryRoot();
    const store = openStore(root);
    await store.initialize();
    const embedding = [0.1, 0.2, 0.3];

    const first = await store.create(
      {
        name: "  Café Research / Notes  ",
        definition: "  Research about coffee origins.  ",
      },
      embedding,
      "fixture-v1",
    );
    const second = await store.create(
      {
        name: "Café Research / Notes",
        definition: "A separate category with the same display name.",
      },
      embedding,
      "fixture-v1",
    );

    expect(first).toEqual(
      expect.objectContaining({
        id: "cafe_research_notes",
        name: "Café Research / Notes",
        definition: "Research about coffee origins.",
        folder: "cafe-research-notes",
        embedding,
        embeddingProvider: "fixture-v1",
        isSeed: false,
      }),
    );
    expect(second).toEqual(
      expect.objectContaining({
        id: "cafe_research_notes_2",
        folder: "cafe-research-notes-2",
      }),
    );
    await expectDirectory(store.folderPath(first));
    await expectDirectory(store.folderPath(second));
    expect(store.get(first.id)).toEqual(first);
  });

  it("persists a dynamic category and recreates a missing folder after restart", async () => {
    const root = await temporaryRoot();
    const firstStore = openStore(root);
    await firstStore.initialize();
    const created = await firstStore.create(
      {
        name: "Bicycle Maintenance",
        definition: "Repair notes for bicycles and related equipment.",
      },
      [1, 0, 0],
      "fixture-v1",
    );
    const folder = firstStore.folderPath(created);
    firstStore.close();
    await rm(folder, { recursive: true });

    const restarted = openStore(root);
    expect(restarted.get(created.id)).toEqual(created);
    await expect(access(folder)).rejects.toMatchObject({ code: "ENOENT" });

    await restarted.initialize();

    await expectDirectory(folder);
    expect(restarted.get(created.id)).toEqual(created);
  });

  it("deletes the inserted row when its folder cannot be created", async () => {
    const root = await temporaryRoot();
    const store = openStore(root);
    await store.initialize();
    const blockingPath = path.join(root, "library", "blocked-topic");
    await writeFile(blockingPath, "this is a file, not a folder", "utf8");

    await expect(
      store.create(
        { name: "Blocked Topic", definition: "This creation must roll back." },
        [1, 0, 0],
        "fixture-v1",
      ),
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(store.get("blocked_topic")).toBeNull();
    expect(store.list().filter(({ isSeed }) => !isSeed)).toEqual([]);
    await expect(readFile(blockingPath, "utf8")).resolves.toBe(
      "this is a file, not a folder",
    );
  });

  it("rejects a name that cannot produce a safe id or folder", async () => {
    const root = await temporaryRoot();
    const store = openStore(root);
    await store.initialize();

    await expect(
      store.create({ name: "---", definition: "Invalid name." }, [1], "fixture-v1"),
    ).rejects.toThrow(/must contain letters or numbers/);
    expect(store.list()).toHaveLength(SEED_CATEGORIES.length);
  });
});

describe("CategoryStore embeddings", () => {
  it("embeds every missing category and reuses persisted vectors from the same provider", async () => {
    const root = await temporaryRoot();
    const store = openStore(root);
    const fixtureProvider = provider();

    await store.ensureEmbeddings(fixtureProvider);

    expect(fixtureProvider.embed).toHaveBeenCalledTimes(SEED_CATEGORIES.length);
    for (const category of store.list()) {
      expect(category.embedding).toHaveLength(fixtureProvider.dimensions);
      expect(category.embeddingProvider).toBe(fixtureProvider.id);
      expect(fixtureProvider.embed).toHaveBeenCalledWith(categoryText(category));
    }

    await store.ensureEmbeddings(fixtureProvider);
    expect(fixtureProvider.embed).toHaveBeenCalledTimes(SEED_CATEGORIES.length);
    store.close();

    const restarted = openStore(root);
    const sameProvider = provider();
    await restarted.ensureEmbeddings(sameProvider);
    expect(sameProvider.embed).not.toHaveBeenCalled();
    expect(
      restarted.list().every(({ embeddingProvider }) => embeddingProvider === "fixture-v1"),
    ).toBe(true);
  });

  it("refreshes stored embeddings when the provider identity changes", async () => {
    const root = await temporaryRoot();
    const store = openStore(root);
    await store.ensureEmbeddings(provider("fixture-v1", 3));
    const replacement = provider("fixture-v2", 4);

    await store.ensureEmbeddings(replacement);

    expect(replacement.embed).toHaveBeenCalledTimes(SEED_CATEGORIES.length);
    expect(
      store.list().every(
        ({ embedding, embeddingProvider }) =>
          embedding?.length === 4 && embeddingProvider === "fixture-v2",
      ),
    ).toBe(true);
  });
});
