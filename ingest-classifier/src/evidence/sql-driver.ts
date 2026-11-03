/** Independent evidence SQL interface; transactions preserve immutable bindings (DEC-028). */
import type { DatabaseSync } from "node:sqlite";

type SqlValue = string | number | null;
/** Synchronous operations ensure an evidence transaction never spans an await. */
export type EvidenceSqlDriver = {
  exec(query: string): void;
  prepare(query: string): {
    run(...args: SqlValue[]): unknown;
    get(...args: SqlValue[]): unknown;
    all(...args: SqlValue[]): unknown[];
  };
  transaction<T>(operation: () => T): T;
};
/** Minimal SQLite-backed Durable Object storage surface. */
export type DurableEvidenceSqlStorage = {
  sql: { exec(query: string, ...args: SqlValue[]): { toArray(): unknown[] } };
  transactionSync<T>(operation: () => T): T;
};

/** Retain existing local SQLite transaction behavior. */
export function nodeEvidenceDriver(db: DatabaseSync): EvidenceSqlDriver {
  return {
    exec: (query) => db.exec(query),
    prepare: (query) => db.prepare(query),
    transaction<T>(operation: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** Consume every Durable Object SQL cursor before returning to the caller. */
export function durableEvidenceDriver(
  storage: DurableEvidenceSqlStorage,
): EvidenceSqlDriver {
  return {
    exec(query) {
      storage.sql.exec(query).toArray();
    },
    prepare(query) {
      return {
        run(...args) {
          storage.sql.exec(query, ...args).toArray();
        },
        get(...args) {
          return storage.sql.exec(query, ...args).toArray()[0];
        },
        all(...args) {
          return storage.sql.exec(query, ...args).toArray();
        },
      };
    },
    transaction: (operation) => storage.transactionSync(operation),
  };
}
