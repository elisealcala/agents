/**
 * A conservative filesystem lock that lets only one ingestion run own a
 * library at a time (DEC-018).
 *
 * Competing ingestion is rejected outright rather than queued: two runs moving
 * files through the same inbox would interleave classification and taxonomy
 * writes. The lock covers ingestion driven by the application, the CLI and the
 * MCP server — not direct low-level pipeline calls.
 */
import { mkdir, realpath, rmdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { OperationFailure } from "./contracts.ts";

/** The lock directory's name, created directly inside the library root. */
export const INGESTION_LOCK_NAME = ".ingest-classifier.lock";

/**
 * Take the ingestion lock, returning an idempotent release function.
 *
 * Throws `LIBRARY_BUSY` when another run already holds it. The lock is not
 * reclaimed automatically after a crash: a stale lock needs a human to confirm
 * no ingestion is still running before removing it, which is safer than
 * assuming a dead owner and moving files underneath a live process.
 */
export async function acquireIngestionLock(
  root: string,
): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true });
  // Resolve symlinks first: two different paths for one library must contend
  // for the same lock rather than each creating their own.
  const canonicalRoot = await realpath(root);
  const lockPath = path.join(canonicalRoot, INGESTION_LOCK_NAME);
  try {
    // mkdir is the atomic primitive here: it either creates the directory or
    // fails with EEXIST, with no window between checking and taking.
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
