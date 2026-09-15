import { mkdir, realpath, rmdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { OperationFailure } from "./contracts.ts";

export const INGESTION_LOCK_NAME = ".ingest-classifier.lock";

export async function acquireIngestionLock(
  root: string,
): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  const lockPath = path.join(canonicalRoot, INGESTION_LOCK_NAME);
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new OperationFailure(
        "LIBRARY_BUSY",
        `Ingestion is already locked for ${canonicalRoot}. Stop the active run/watch before retrying. After a crash, confirm no ingestion process remains before removing ${lockPath}.`,
      );
    }
    throw error;
  }
  const ownerPath = path.join(lockPath, "owner.json");
  try {
    await writeFile(
      ownerPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        root: canonicalRoot,
      }),
      { flag: "wx" },
    );
  } catch (error) {
    await rmdir(lockPath);
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    await unlink(ownerPath);
    await rmdir(lockPath);
    released = true;
  };
}
