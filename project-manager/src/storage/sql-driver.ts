/** Minimal synchronous SQL boundary shared by the local owner and durable storage. */
import type { DatabaseSync } from "node:sqlite";

type SqlInputValue = string | number | null;

export type SqlStatement = {
  run(...args: SqlInputValue[]): { changes: number | bigint };
  get(...args: SqlInputValue[]): unknown;
  all(...args: SqlInputValue[]): unknown[];
};
export type SqlDriver = {
  exec(query: string): void;
  prepare(query: string): SqlStatement;
  transaction<T>(operation: () => T): T;
};

export function createNodeSqlDriver(db: DatabaseSync): SqlDriver {
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

type DurableCursor = { toArray(): unknown[]; rowsWritten: number };
export type DurableSqlStorage = {
  sql: { exec(query: string, ...args: SqlInputValue[]): DurableCursor };
  transactionSync<T>(operation: () => T): T;
};

/** Cursors are fully consumed synchronously, before any await or later request. */
export function createDurableSqlDriver(storage: DurableSqlStorage): SqlDriver {
  return {
    exec(query) {
      storage.sql.exec(query).toArray();
    },
    prepare(query) {
      return {
        run(...args) {
          const cursor = storage.sql.exec(query, ...args);
          cursor.toArray();
          // rowsWritten is a billing metric and includes index writes; use SQLite's
          // affected-row count for optimistic concurrency and fencing checks.
          const rows = storage.sql
            .exec("SELECT changes() AS changed")
            .toArray();
          const changed = (rows[0] as { changed?: unknown } | undefined)
            ?.changed;
          if (
            typeof changed !== "number" ||
            !Number.isSafeInteger(changed) ||
            changed < 0
          )
            throw new Error("SQLite affected-row count unavailable");
          return { changes: changed };
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
