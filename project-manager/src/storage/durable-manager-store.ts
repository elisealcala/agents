import { ManagerStore } from "./manager-store.ts";
import {
  createDurableSqlDriver,
  type DurableSqlStorage,
} from "./sql-driver.ts";

/** Construct only inside the Durable Object that owns this storage. */
export class DurableManagerStore extends ManagerStore {
  constructor(storage: DurableSqlStorage) {
    super(createDurableSqlDriver(storage));
  }
}
