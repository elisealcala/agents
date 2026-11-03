/** Crash-resumable two-store import. The host must serialize all access while locked. */
import { type Snapshot, validateSnapshotPair } from "../storage/snapshot.ts";

export type MigrationMarker = {
  version: 1;
  manager: string;
  evidence: string;
  phase: "locked" | "evidence" | "complete";
};
export type MigrationDependencies = {
  /** Exclusive across imports AND normal requests, including asynchronous storage operations. */
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  loadMarker(): Promise<MigrationMarker | null>;
  /** Must be durable before resolving. Non-complete markers must deny normal access after restart. */
  saveMarker(marker: MigrationMarker): Promise<void>;
  preflightManager(snapshot: Snapshot): Promise<void>;
  preflightEvidence(snapshot: Snapshot): Promise<void>;
  readEvidenceDigest(): Promise<string>;
  restoreEvidence(snapshot: Snapshot): Promise<void>;
  readManagerDigest(): Promise<string>;
  restoreManager(snapshot: Snapshot): Promise<void>;
};

/**
 * Both restore operations must reject nonempty stores and be transactional. A partial
 * import stays locked until the exact same pair is successfully retried. A completed
 * marker is terminal: later application writes must never be mistaken for a new import.
 */
export async function migrateSnapshotPair(
  input: { manager: Snapshot; evidence: Snapshot },
  deps: MigrationDependencies,
): Promise<void> {
  validateSnapshotPair(input.manager, input.evidence);
  assertMigrationQuiescent(input.manager);
  const manager = input.manager.sha256;
  const evidence = input.evidence.sha256;
  await deps.runExclusive(async () => {
    let marker = await deps.loadMarker();
    if (marker) {
      if (
        marker.version !== 1 ||
        !["locked", "evidence", "complete"].includes(marker.phase) ||
        marker.manager !== manager ||
        marker.evidence !== evidence
      )
        throw new Error("A different or invalid migration is already recorded");
      if (marker.phase === "complete") return;
    } else {
      await deps.preflightManager(input.manager);
      await deps.preflightEvidence(input.evidence);
      marker = { version: 1, manager, evidence, phase: "locked" };
      await deps.saveMarker(marker);
    }
    if ((await deps.readEvidenceDigest()) !== evidence)
      await deps.restoreEvidence(input.evidence);
    if ((await deps.readEvidenceDigest()) !== evidence)
      throw new Error("Evidence restore verification failed");
    if (marker.phase === "locked") {
      marker = { ...marker, phase: "evidence" };
      await deps.saveMarker(marker);
    }
    if ((await deps.readManagerDigest()) !== manager)
      await deps.restoreManager(input.manager);
    if ((await deps.readManagerDigest()) !== manager)
      throw new Error("Manager restore verification failed");
    await deps.saveMarker({ ...marker, phase: "complete" });
  });
}

/** Restart recovery must not rewrite a half-restored database before verification. */
export function assertMigrationQuiescent(manager: Snapshot): void {
  for (const [, data] of manager.tables[1].rows) {
    if (typeof data !== "string") throw new Error("Invalid run record");
    const run: unknown = JSON.parse(data);
    if (
      !run ||
      typeof run !== "object" ||
      !("status" in run) ||
      typeof run.status !== "string"
    )
      throw new Error("Invalid run record");
    if (run.status === "running")
      throw new Error("Migration requires stopped runs");
  }
  for (const [, data] of manager.tables[0].rows) {
    if (typeof data !== "string") throw new Error("Invalid project record");
    const project: unknown = JSON.parse(data);
    if (
      !project ||
      typeof project !== "object" ||
      !("notes" in project) ||
      !Array.isArray(project.notes)
    )
      throw new Error("Invalid project record");
    for (const note of project.notes as unknown[]) {
      if (
        !note ||
        typeof note !== "object" ||
        !("status" in note) ||
        typeof note.status !== "string"
      )
        throw new Error("Invalid note record");
      if (["queued", "storing", "extracting"].includes(note.status))
        throw new Error("Migration requires stopped note intake");
    }
  }
  if (
    manager.tables[4].rows.some((row) => row[5] === "dispatching") ||
    manager.tables[6].rows.some((row) => row[3] === "running")
  )
    throw new Error("Migration requires stopped delivery attempts");
}
