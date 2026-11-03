/** Local SQLite implementation of immutable project evidence (DEC-028). */
import { DatabaseSync } from "node:sqlite";
import { EvidenceCoreStore } from "./core-store.ts";
import { nodeEvidenceDriver } from "./sql-driver.ts";
export { MAXIMUM_EVIDENCE_CHUNK_LENGTH, hashMarkdown } from "./core-store.ts";
export type { EvidenceRecord, StoredEvidenceChunk } from "./core-store.ts";

/** A local evidence store owns and closes its SQLite connection. */
export class EvidenceStore extends EvidenceCoreStore {
  private readonly connection: DatabaseSync;
  constructor(database: string) {
    const connection = new DatabaseSync(database);
    try {
      connection.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      super(nodeEvidenceDriver(connection));
      this.connection = connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }
  override close(): void {
    this.connection.close();
  }
}
