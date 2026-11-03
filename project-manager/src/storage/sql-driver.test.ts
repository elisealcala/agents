import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDurableSqlDriver,
  createNodeSqlDriver,
  type DurableSqlStorage,
  type SqlDriver,
} from "./sql-driver.ts";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup(kind: "node" | "durable") {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(
    "CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  const cursors: Array<{
    rowsWritten: number;
    toArray: ReturnType<typeof vi.fn>;
  }> = [];
  const storage: DurableSqlStorage = {
    sql: {
      exec(query: string, ...args: SQLInputValue[]) {
        const statement = database.prepare(query);
        const isRead = /^\s*SELECT\b/i.test(query);
        const rows = isRead ? statement.all(...args) : [];
        const changes = isRead ? 0 : Number(statement.run(...args).changes);
        // Simulate Cloudflare's index-inclusive billing count; SELECT changes()
        // still reports only the SQL statement's affected rows.
        const rowsWritten = changes > 0 ? changes + 2 : 0;
        const cursor = { rowsWritten, toArray: vi.fn(() => rows) };
        cursors.push(cursor);
        return cursor;
      },
    },
    transactionSync<T>(operation: () => T): T {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const driver: SqlDriver =
    kind === "node"
      ? createNodeSqlDriver(database)
      : createDurableSqlDriver(storage);
  return { database, cursors, driver };
}

describe.each(["node", "durable"] as const)("%s SQL driver", (kind) => {
  it("executes bound writes and reads, reporting affected rows", () => {
    const { driver } = setup(kind);
    const insert = driver.prepare(
      "INSERT INTO records (id, value) VALUES (?, ?)",
    );
    expect(Number(insert.run("one", "First").changes)).toBe(1);
    expect(Number(insert.run("two", "Second").changes)).toBe(1);
    const read = driver.prepare("SELECT id, value FROM records WHERE id = ?");
    expect(read.get("one")).toEqual({ id: "one", value: "First" });
    expect(read.get("missing")).toBeUndefined();
    expect(
      driver.prepare("SELECT id, value FROM records ORDER BY id").all(),
    ).toEqual([
      { id: "one", value: "First" },
      { id: "two", value: "Second" },
    ]);
    expect(
      Number(
        driver
          .prepare("UPDATE records SET value = ? WHERE id = ?")
          .run("No change", "missing").changes,
      ),
    ).toBe(0);
  });

  it("commits a successful transaction and returns its result", () => {
    const { driver } = setup(kind);
    const result = driver.transaction(() => {
      driver
        .prepare("INSERT INTO records (id, value) VALUES (?, ?)")
        .run("one", "Saved");
      return "committed";
    });
    expect(result).toBe("committed");
    expect(
      driver.prepare("SELECT value FROM records WHERE id = ?").get("one"),
    ).toEqual({ value: "Saved" });
  });

  it("rolls back all writes when a transaction throws", () => {
    const { driver } = setup(kind);
    expect(() =>
      driver.transaction(() => {
        const insert = driver.prepare(
          "INSERT INTO records (id, value) VALUES (?, ?)",
        );
        insert.run("one", "First");
        insert.run("one", "Duplicate");
      }),
    ).toThrow();
    expect(driver.prepare("SELECT id FROM records").all()).toEqual([]);
    expect(() =>
      driver.transaction(() => {
        throw new Error("fixture failure");
      }),
    ).toThrow("fixture failure");
  });
});

describe("durable SQL cursor handling", () => {
  it("uses SQLite affected rows rather than index-inclusive write counts", () => {
    const { database, driver, cursors } = setup("durable");
    database.exec("CREATE INDEX records_value ON records(value)");
    const insert = driver.prepare(
      "INSERT INTO records (id, value) VALUES (?, ?)",
    );
    expect(insert.run("one", "First").changes).toBe(1);
    expect(cursors[0].rowsWritten).toBe(3);
    const update = driver.prepare("UPDATE records SET value = ? WHERE id = ?");
    expect(update.run("Updated", "one").changes).toBe(1);
    expect(cursors[2].rowsWritten).toBe(3);
    expect(update.run("Unused", "missing").changes).toBe(0);
  });

  it("fails closed when the affected-row count is missing or invalid", () => {
    for (const changed of [undefined, null, -1, 0.5, "1"]) {
      const storage: DurableSqlStorage = {
        sql: {
          exec: (query) => ({
            rowsWritten: 9,
            toArray: () =>
              query.startsWith("SELECT changes()") ? [{ changed }] : [],
          }),
        },
        transactionSync: (operation) => operation(),
      };
      const driver = createDurableSqlDriver(storage);
      expect(() =>
        driver.prepare("UPDATE records SET value = ?").run("x"),
      ).toThrow("SQLite affected-row count unavailable");
    }
  });

  it("consumes write, single-row, and multi-row cursors synchronously", () => {
    const { driver, cursors } = setup("durable");
    driver
      .prepare("INSERT INTO records (id, value) VALUES (?, ?)")
      .run("one", "First");
    const row = driver
      .prepare("SELECT id, value FROM records WHERE id = ?")
      .get("one");
    const rows = driver
      .prepare("SELECT id, value FROM records ORDER BY id")
      .all();
    expect(cursors).toHaveLength(4);
    for (const cursor of cursors) expect(cursor.toArray).toHaveBeenCalledOnce();
    driver
      .prepare("UPDATE records SET value = ? WHERE id = ?")
      .run("Changed", "one");
    expect(row).toEqual({ id: "one", value: "First" });
    expect(rows).toEqual([{ id: "one", value: "First" }]);
  });
});
