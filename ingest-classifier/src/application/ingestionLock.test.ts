import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireIngestionLock, INGESTION_LOCK_NAME } from "./ingestionLock.ts";

const execute = promisify(execFile);
const roots: string[] = [];
const releases: Array<() => Promise<void>> = [];
const loader = fileURLToPath(import.meta.resolve("tsx"));
const lockModule = new URL("./ingestionLock.ts", import.meta.url).href;
afterEach(async () => {
  await Promise.all(releases.splice(0).map((release) => release()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ingestion-lock-test-"),
  );
  roots.push(directory);
  return directory;
}
async function acquireInChild(directory: string) {
  const code = `import { acquireIngestionLock } from ${JSON.stringify(lockModule)};
try { const release = await acquireIngestionLock(process.argv[1]); await release(); console.log(JSON.stringify({ acquired: true })); }
catch (error) { console.log(JSON.stringify({ acquired: false, code: error.code })); }`;
  const { stdout } = await execute(process.execPath, [
    "--import",
    loader,
    "--input-type=module",
    "--eval",
    code,
    directory,
  ]);
  return JSON.parse(stdout) as { acquired: boolean; code?: string };
}

describe("ingestion library lock", () => {
  it("rejects another process and permits acquisition after an idempotent release", async () => {
    const directory = await root();
    const release = await acquireIngestionLock(directory);
    releases.push(release);
    const owner = JSON.parse(
      await readFile(
        path.join(directory, INGESTION_LOCK_NAME, "owner.json"),
        "utf8",
      ),
    ) as { pid: number; root: string };
    expect(owner.pid).toBe(process.pid);
    expect(await acquireInChild(directory)).toEqual({
      acquired: false,
      code: "LIBRARY_BUSY",
    });
    await release();
    await release();
    expect(await acquireInChild(directory)).toEqual({ acquired: true });
    await expect(
      access(path.join(directory, INGESTION_LOCK_NAME)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows different libraries but treats symlink aliases as the same library", async () => {
    const directory = await root();
    const other = await root();
    releases.push(await acquireIngestionLock(directory));
    expect(await acquireInChild(other)).toEqual({ acquired: true });
    const alias = path.join(other, "alias");
    await symlink(directory, alias, "dir");
    expect(await acquireInChild(alias)).toEqual({
      acquired: false,
      code: "LIBRARY_BUSY",
    });
  });

  it("does not steal a stale lock from an abruptly terminated owner", async () => {
    const directory = await root();
    const lock = path.join(directory, INGESTION_LOCK_NAME);
    await mkdir(lock);
    const owner = JSON.stringify({
      pid: 2147483647,
      startedAt: "2000-01-01T00:00:00.000Z",
    });
    await writeFile(path.join(lock, "owner.json"), owner);
    await expect(acquireIngestionLock(directory)).rejects.toMatchObject({
      code: "LIBRARY_BUSY",
    });
    expect(await readFile(path.join(lock, "owner.json"), "utf8")).toBe(owner);
  });
});
