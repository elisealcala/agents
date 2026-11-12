import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionStore } from "./connection-store.ts";
import { createNodeSqlDriver } from "./sql-driver.ts";

const roots: string[] = [];
const dbs: DatabaseSync[] = [];
const keyA = new Uint8Array(32).fill(1);
const keyB = new Uint8Array(32).fill(2);
const secret = "ghs_super_secret_token";
const now = "2026-11-01T12:00:00.000Z";
const input = { id: "c1", kind: "app" as const, externalRef: "install-1" };

async function file() {
  const root = await mkdtemp(path.join(os.tmpdir(), "connection-store-"));
  roots.push(root);
  return path.join(root, "m.sqlite");
}
function open(name: string, key = keyA) {
  const db = new DatabaseSync(name);
  dbs.push(db);
  return { db, store: new ConnectionStore(createNodeSqlDriver(db), key) };
}
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed by a restart */
    }
  }
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});

describe("connection store", () => {
  it("preserves identity and status across restart without storing keys or plaintext", async () => {
    const name = await file();
    const first = open(name);
    first.store.create(
      { ...input, credential: secret, capabilities: { repositoryRead: true } },
      now,
    );
    first.db.close();
    const second = open(name);
    const view = second.store.get("c1");
    expect(view).toMatchObject({
      id: "c1",
      externalRef: "install-1",
      status: "connected",
      capabilities: { repositoryRead: true, inventorySync: false },
    });
    expect(second.store.readCredential("c1")).toBe(secret);
    const dump = JSON.stringify(
      second.db.prepare("SELECT * FROM github_connections").all(),
    );
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain(Buffer.from(keyA).toString("base64"));
  });

  it("fails wrong-key reads with a redacted error", async () => {
    const name = await file();
    open(name).store.create({ ...input, credential: secret }, now);
    const wrong = open(name, keyB);
    let message = "";
    try {
      wrong.store.readCredential("c1");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("Credential unavailable");
    expect(message).not.toContain(secret);
  });

  it("rejects stale revisions and enabling later-stage capabilities", async () => {
    const { store } = open(await file());
    store.create({ ...input, credential: secret }, now);
    store.updateState("c1", 0, "degraded", { repositoryRead: true }, now);
    expect(() => store.rotate("c1", 0, "new", now)).toThrow(
      "Revision conflict",
    );
    expect(() => store.disconnect("c1", 0, now)).toThrow("Revision conflict");
    expect(() =>
      store.updateState("c1", 1, "connected", { inventorySync: true }, now),
    ).toThrow("not available");
    expect(store.get("c1").revision).toBe(1);
  });

  it("isolates connections and binds ciphertext to its record", async () => {
    const { db, store } = open(await file());
    store.create({ ...input, credential: secret }, now);
    store.create({ ...input, id: "c2", credential: "other-token" }, now);
    expect(store.readCredential("c2")).toBe("other-token");
    expect(() => store.create({ ...input, credential: "x" }, now)).toThrow(
      "Connection exists",
    );
    db.prepare(
      "UPDATE github_connections SET credential=(SELECT credential FROM github_connections WHERE id='c1') WHERE id='c2'",
    ).run();
    expect(() => store.readCredential("c2")).toThrow("Credential unavailable");
    expect(() => store.readCredential("missing")).toThrow(
      "Credential unavailable",
    );
  });

  it("revokes credentials on rotation and disconnect while keeping receipts", async () => {
    const { db, store } = open(await file());
    store.create({ ...input, credential: secret }, now);
    const old = (
      db.prepare("SELECT credential FROM github_connections").get() as {
        credential: string;
      }
    ).credential;
    store.rotate("c1", 0, "rotated-token", now);
    expect(store.readCredential("c1")).toBe("rotated-token");
    expect(
      (
        db.prepare("SELECT credential FROM github_connections").get() as {
          credential: string;
        }
      ).credential,
    ).not.toBe(old);
    const view = store.disconnect("c1", 1, now);
    expect(view).toMatchObject({
      status: "disconnected",
      hasCredential: false,
      revision: 2,
      capabilities: { repositoryRead: false },
    });
    expect(() => store.readCredential("c1")).toThrow("Credential unavailable");
    expect(() => store.rotate("c1", 2, "again", now)).toThrow("disconnected");
    expect(store.receipts("c1").map((r) => r.action)).toEqual([
      "created",
      "rotated",
      "disconnected",
    ]);
  });
});
