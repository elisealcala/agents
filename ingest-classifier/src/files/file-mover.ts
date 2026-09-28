/**
 * Collision-safe file movement (DEC-005).
 *
 * A note is never allowed to overwrite an existing file, and the source is
 * removed only once the destination is confirmed byte-identical. If anything
 * fails in between, the original stays in the inbox and the run can be retried.
 */
import { constants } from "node:fs";
import { copyFile, link, readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/** Where a file ended up, and the hash that proved the copy was faithful. */
export type MoveResult = {
  sourcePath: string;
  destinationPath: string;
  sha256: string;
};

/**
 * Move a file into a folder without ever replacing an existing file.
 *
 * On a name collision the destination becomes `name-2.md`, `name-3.md`, and so
 * on. When `expectedSha256` is supplied the copy is verified against it before
 * the source is unlinked, so a corrupted move loses nothing.
 */
export async function moveWithoutOverwrite(
  sourcePath: string,
  destinationFolder: string,
  expectedSha256?: string,
): Promise<MoveResult> {
  const parsed = path.parse(sourcePath);
  // Unbounded by design: each EEXIST means this exact name is taken, so the
  // next suffix is tried. It terminates as soon as one name is free.
  for (let suffix = 1; ; suffix += 1) {
    const filename =
      suffix === 1 ? parsed.base : `${parsed.name}-${suffix}${parsed.ext}`;
    const destinationPath = path.join(destinationFolder, filename);
    try {
      await createDestination(sourcePath, destinationPath);
      const sha256 = await hashFile(destinationPath);
      if (expectedSha256 && sha256 !== expectedSha256) {
        await unlink(destinationPath);
        // Kept short and path-free on purpose: this string is copied into the
        // process report and the audit row, which already carry the paths,
        // and both are asserted on. Context belongs there, not here.
        throw new Error("destination verification failed");
      }
      await unlink(sourcePath);
      return { sourcePath, destinationPath, sha256 };
    } catch (error) {
      if (isCode(error, "EEXIST")) continue;
      throw error;
    }
  }
}

/** Undo a move, putting a filed note back where it came from. */
export async function restoreMovedFile(
  destinationPath: string,
  sourcePath: string,
): Promise<void> {
  await createDestination(destinationPath, sourcePath);
  await unlink(destinationPath);
}

/**
 * Create the destination without clobbering anything.
 *
 * A hard link is preferred because it is atomic and cannot truncate an
 * existing file. It fails with EXDEV across filesystems and EPERM where links
 * are not permitted, so those two cases fall back to an exclusive copy. Any
 * other error, including EEXIST, propagates to the caller.
 */
async function createDestination(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  try {
    await link(sourcePath, destinationPath);
  } catch (error) {
    if (!isCode(error, "EXDEV") && !isCode(error, "EPERM")) throw error;
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  }
}

async function hashFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

/** Match a Node filesystem error by its `code`. */
function isCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
