/** Node-owned SQLite store with a process ownership lock. */
import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ManagerStore } from "./manager-store.ts";
import { createNodeSqlDriver } from "./sql-driver.ts";

export class Store extends ManagerStore {
  private readonly connection: DatabaseSync;
  private readonly ownerLock: DatabaseSync;
  constructor(filename: string) {
    const requested = path.resolve(filename);
    mkdirSync(path.dirname(requested), { recursive: true });
    let absolute: string;
    try {
      absolute = realpathSync(requested);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        lstatSync(requested);
        throw new Error("Database path is a dangling link");
      } catch (entryError) {
        if ((entryError as NodeJS.ErrnoException).code !== "ENOENT")
          throw entryError;
      }
      absolute = path.join(
        realpathSync(path.dirname(requested)),
        path.basename(requested),
      );
    }
    try {
      const info = statSync(absolute);
      if (!info.isFile() || info.nlink !== 1)
        throw new Error("Manager database must be a single-link file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const ownerLock = new DatabaseSync(`${absolute}.owner`);
    try {
      ownerLock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    } catch (error) {
      ownerLock.close();
      throw new Error("Manager database already has an owner", {
        cause: error,
      });
    }
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(absolute);
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
      );
      super(createNodeSqlDriver(db));
      this.connection = db;
      this.ownerLock = ownerLock;
    } catch (error) {
      db?.close();
      ownerLock.exec("ROLLBACK");
      ownerLock.close();
      throw error;
    }
  }
  override close(): void {
    this.connection.close();
    this.ownerLock.exec("ROLLBACK");
    this.ownerLock.close();
  }
}
