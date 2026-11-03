/** Daily, verified, private backup scheduling; no provider or dispatch jobs are enabled here. */
import { type Snapshot, validateSnapshotPair } from "../storage/snapshot.ts";
import { assertMigrationQuiescent } from "./migration.ts";

export const BACKUP_RETRY_MS = 15 * 60 * 1000;
export const BACKUP_INTERVAL_MS = 23 * 60 * 60 * 1000;
export const MAXIMUM_BACKUP_BYTES = 8 * 1024 * 1024;
export type BackupStatus = { state: "ok" | "error"; at: string; key?: string };
export type BackupDependencies = {
  now(): number;
  schedule(at: number): Promise<void>;
  capture(): Promise<{ manager: Snapshot; evidence: Snapshot }>;
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  record(status: BackupStatus): Promise<void>;
  id(): string;
};

/** Pre-arm a retry before any work; a crash cannot silently stop recurring backups. */
export async function runScheduledBackup(
  deps: BackupDependencies,
): Promise<void> {
  const start = deps.now();
  if (!Number.isSafeInteger(start) || start < 0)
    throw new Error("Invalid backup time");
  await deps.schedule(start + BACKUP_RETRY_MS);
  try {
    const pair = await deps.capture();
    validateSnapshotPair(pair.manager, pair.evidence);
    assertMigrationQuiescent(pair.manager);
    const body = JSON.stringify(pair);
    if (Buffer.byteLength(body, "utf8") > MAXIMUM_BACKUP_BYTES)
      throw new Error("Backup exceeds supported restore size");
    const id = deps.id();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error("Invalid backup ID");
    const key = `manager-backups/${new Date(start).toISOString().slice(0, 10)}/${start}-${id}.json`;
    await deps.put(key, body);
    if ((await deps.get(key)) !== body)
      throw new Error("Backup verification failed");
    await deps.record({ state: "ok", at: new Date(start).toISOString(), key });
    await deps.schedule(deps.now() + BACKUP_INTERVAL_MS);
  } catch {
    try {
      await deps.record({ state: "error", at: new Date(start).toISOString() });
    } catch {
      /* retry remains armed */
    }
    throw new Error("Scheduled backup failed");
  }
}
