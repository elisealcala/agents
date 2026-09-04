import { constants } from "node:fs";
import { copyFile, link, readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export type MoveResult = {
  sourcePath: string;
  destinationPath: string;
  sha256: string;
};

export async function moveWithoutOverwrite(
  sourcePath: string,
  destinationFolder: string,
  expectedSha256?: string,
): Promise<MoveResult> {
  const parsed = path.parse(sourcePath);
  for (let suffix = 1; ; suffix += 1) {
    const filename =
      suffix === 1 ? parsed.base : `${parsed.name}-${suffix}${parsed.ext}`;
    const destinationPath = path.join(destinationFolder, filename);
    try {
      await createDestination(sourcePath, destinationPath);
      const sha256 = await hashFile(destinationPath);
      if (expectedSha256 && sha256 !== expectedSha256) {
        await unlink(destinationPath);
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

export async function restoreMovedFile(
  destinationPath: string,
  sourcePath: string,
): Promise<void> {
  await createDestination(destinationPath, sourcePath);
  await unlink(destinationPath);
}

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

function isCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
