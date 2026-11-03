/** Durable Object evidence storage preserves independent classifier ownership (DEC-028). */
import { EvidenceCoreStore } from "./core-store.ts";
import {
  durableEvidenceDriver,
  type DurableEvidenceSqlStorage,
} from "./sql-driver.ts";
export type { DurableEvidenceSqlStorage } from "./sql-driver.ts";

/** Instantiate only within the Durable Object that owns this evidence database. */
export class DurableEvidenceStore extends EvidenceCoreStore {
  constructor(storage: DurableEvidenceSqlStorage) {
    super(durableEvidenceDriver(storage));
  }
}
