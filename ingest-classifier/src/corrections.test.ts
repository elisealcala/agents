import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CorrectionStore,
  DEFAULT_CORRECTION_EXAMPLE_LIMIT,
} from "./corrections.ts";

const stores: CorrectionStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // Persistence tests may already have closed a connection.
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDatabase(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "corrections-test-"));
  temporaryDirectories.push(root);
  return path.join(root, "nested", "library.sqlite");
}

function openStore(databasePath: string): CorrectionStore {
  const store = new CorrectionStore(databasePath);
  stores.push(store);
  return store;
}

describe("CorrectionStore", () => {
  it("normalizes and persists corrections across restart", async () => {
    const databasePath = await temporaryDatabase();
    const first = openStore(databasePath);

    const correction = first.record({
      originalPath: "  /vault/library/architecture-code/retro.md  ",
      wrongCategory: "  architecture_code ",
      correctCategory: " meeting_notes  ",
      note: "  Retrospective action items belong with meetings.  ",
    });
    const withoutNote = first.record({
      originalPath: "/vault/library/reference-material/idea.md",
      wrongCategory: "reference_material",
      correctCategory: "personal_ideas",
      note: "   ",
    });

    expect(correction).toEqual({
      id: expect.any(Number),
      originalPath: "/vault/library/architecture-code/retro.md",
      wrongCategory: "architecture_code",
      correctCategory: "meeting_notes",
      note: "Retrospective action items belong with meetings.",
      createdAt: expect.any(String),
    });
    expect(withoutNote.note).toBeNull();
    expect(first.get(correction.id)).toEqual(correction);
    expect(first.get(999)).toBeNull();
    first.close();

    const restarted = openStore(databasePath);
    expect(restarted.get(correction.id)).toEqual(correction);
    expect(restarted.get(withoutNote.id)).toEqual(withoutNote);
  });

  it.each([
    [
      "path",
      { originalPath: " ", wrongCategory: "wrong", correctCategory: "correct" },
      /path is required/,
    ],
    [
      "wrong category",
      { originalPath: "note.md", wrongCategory: " ", correctCategory: "correct" },
      /wrong category is required/,
    ],
    [
      "correct category",
      { originalPath: "note.md", wrongCategory: "wrong", correctCategory: " " },
      /correct category is required/,
    ],
  ])("rejects a correction with a missing %s", async (_name, input, error) => {
    const store = openStore(await temporaryDatabase());

    expect(() => store.record(input)).toThrow(error);
    expect(store.listRecent()).toEqual([]);
  });

  it("caps default prompt examples at the five most recent corrections", async () => {
    const store = openStore(await temporaryDatabase());
    expect(DEFAULT_CORRECTION_EXAMPLE_LIMIT).toBe(5);
    const recorded = Array.from({ length: 7 }, (_, index) =>
      store.record({
        originalPath: `/vault/note-${index + 1}.md`,
        wrongCategory: `wrong_${index + 1}`,
        correctCategory: `correct_${index + 1}`,
        note: index === 6 ? "Newest guidance." : undefined,
      }),
    );

    expect(store.listRecent().map(({ id }) => id)).toEqual(
      recorded.slice(2).reverse().map(({ id }) => id),
    );
    expect(store.listRecent(2).map(({ id }) => id)).toEqual([
      recorded[6]!.id,
      recorded[5]!.id,
    ]);
    expect(store.listRecent(0)).toEqual([]);
    const examples = store.toPromptExamples();
    expect(examples).toHaveLength(5);
    expect(examples[0]).toBe(
      "File /vault/note-7.md was incorrectly classified as wrong_7; use correct_7. Note: Newest guidance.",
    );
    expect(examples.at(-1)).toContain("/vault/note-3.md");
    expect(examples.join("\n")).not.toContain("/vault/note-2.md");
    expect(examples.join("\n")).not.toContain("/vault/note-1.md");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid recent limit of %s",
    async (limit) => {
      const store = openStore(await temporaryDatabase());

      expect(() => store.listRecent(limit)).toThrow(
        /non-negative integer/,
      );
      expect(() => store.toPromptExamples(limit)).toThrow(
        /non-negative integer/,
      );
    },
  );
});
