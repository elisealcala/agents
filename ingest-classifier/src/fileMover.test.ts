import { createHash } from "node:crypto";
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
import { moveWithoutOverwrite, restoreMovedFile } from "./fileMover.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "file-mover-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function expectMissing(filePath: string): Promise<void> {
  await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("moveWithoutOverwrite", () => {
  it("moves the exact bytes and returns their SHA-256", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "inbox", "note.md");
    const destinationFolder = path.join(root, "library");
    const bytes = Buffer.from("# Original\n\0binary-adjacent bytes\n");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(destinationFolder);
    await writeFile(source, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    await expect(moveWithoutOverwrite(source, destinationFolder, sha256)).resolves.toEqual({
      sourcePath: source,
      destinationPath: path.join(destinationFolder, "note.md"),
      sha256,
    });
    await expectMissing(source);
    expect((await readFile(path.join(destinationFolder, "note.md"))).equals(bytes)).toBe(true);
  });

  it("preserves collisions and chooses the next available numeric suffix", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "inbox", "note.md");
    const destinationFolder = path.join(root, "library");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(destinationFolder);
    await writeFile(source, "new", "utf8");
    await writeFile(path.join(destinationFolder, "note.md"), "first", "utf8");
    await writeFile(path.join(destinationFolder, "note-2.md"), "second", "utf8");

    const result = await moveWithoutOverwrite(source, destinationFolder);

    expect(result.destinationPath).toBe(path.join(destinationFolder, "note-3.md"));
    await expect(readFile(path.join(destinationFolder, "note.md"), "utf8")).resolves.toBe(
      "first",
    );
    await expect(
      readFile(path.join(destinationFolder, "note-2.md"), "utf8"),
    ).resolves.toBe("second");
    await expect(
      readFile(path.join(destinationFolder, "note-3.md"), "utf8"),
    ).resolves.toBe("new");
  });

  it("removes an unverifiable destination and leaves the source intact", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "inbox", "note.md");
    const destinationFolder = path.join(root, "library");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(destinationFolder);
    await writeFile(source, "do not lose me", "utf8");

    await expect(
      moveWithoutOverwrite(source, destinationFolder, "incorrect-sha256"),
    ).rejects.toThrow(/destination verification failed/);
    await expect(readFile(source, "utf8")).resolves.toBe("do not lose me");
    await expectMissing(path.join(destinationFolder, "note.md"));
  });

  it("leaves the source intact when the destination cannot be created", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "inbox", "note.md");
    const missingDestination = path.join(root, "missing", "library");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "still here", "utf8");

    await expect(moveWithoutOverwrite(source, missingDestination)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(source, "utf8")).resolves.toBe("still here");
  });
});

describe("restoreMovedFile", () => {
  it("restores destination bytes to the original source path", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "inbox", "note.md");
    const destination = path.join(root, "library", "note.md");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, "restore me", "utf8");

    await restoreMovedFile(destination, source);

    await expect(readFile(source, "utf8")).resolves.toBe("restore me");
    await expectMissing(destination);
  });

  it("does not overwrite an existing source when restoration collides", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "inbox", "note.md");
    const destination = path.join(root, "library", "note.md");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(source, "existing source", "utf8");
    await writeFile(destination, "moved copy", "utf8");

    await expect(restoreMovedFile(destination, source)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await expect(readFile(source, "utf8")).resolves.toBe("existing source");
    await expect(readFile(destination, "utf8")).resolves.toBe("moved copy");
  });
});
