/** Offline export of two already-quiesced SQLite backup files. Never reads a live database safely. */
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { captureSnapshot, validateSnapshotPair } from "./snapshot.ts";
import { assertMigrationQuiescent } from "../cloudflare/migration.ts";

const [managerPath, evidencePath, destination, ...extra] =
  process.argv.slice(2);
if (!managerPath || !evidencePath || !destination || extra.length !== 0) {
  throw new Error(
    "Usage: snapshot-export <manager-backup.sqlite> <evidence-backup.sqlite> <new-output.json>",
  );
}
// readOnly prevents accidental creation or writes to the supplied backup files.
const manager = new DatabaseSync(managerPath, { readOnly: true });
let evidence: DatabaseSync | undefined;
try {
  evidence = new DatabaseSync(evidencePath, { readOnly: true });
  const readDriver = (db: DatabaseSync) => ({
    prepare: (query: string) => db.prepare(query),
    transaction<T>(operation: () => T): T {
      db.exec("BEGIN");
      try {
        const result = operation();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  });
  const managerSnapshot = captureSnapshot(readDriver(manager), "manager");
  const evidenceSnapshot = captureSnapshot(readDriver(evidence), "evidence");
  validateSnapshotPair(managerSnapshot, evidenceSnapshot);
  assertMigrationQuiescent(managerSnapshot);
  // Exclusive create prevents overwriting a previous backup. Snapshots contain private data.
  writeFileSync(
    destination,
    JSON.stringify({ manager: managerSnapshot, evidence: evidenceSnapshot }),
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(
    "Snapshot pair saved. Keep the original database backups.\n",
  );
} finally {
  evidence?.close();
  manager.close();
}
