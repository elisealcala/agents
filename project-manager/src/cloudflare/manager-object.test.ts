import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { DurableSqlStorage } from "../storage/sql-driver.ts";
import { DurableManagerObject } from "./manager-object.ts";

const token = "fixture-service-token-0123456789-abcdefgh";
const owner = "16949569";
const env = { MANAGER_SERVICE_TOKEN: token, MANAGER_OWNER_ID: owner };
const headers = { authorization: `Bearer ${token}`, "x-manager-actor": owner };
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

/** Node SQLite emulates synchronous Durable Object SQL; this is not a Workers runtime test. */
function setup() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const storage: DurableSqlStorage = {
    sql: {
      exec(query, ...values) {
        if (/^\s*SELECT\b/i.test(query)) {
          const rows = database.prepare(query).all(...values);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        if (values.length === 0) {
          database.exec(query);
          return { toArray: () => [], rowsWritten: 0 };
        }
        const result = database.prepare(query).run(...values);
        return { toArray: () => [], rowsWritten: Number(result.changes) };
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
  return {
    database,
    storage,
    service: new DurableManagerObject({ storage }, env),
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://manager.internal/trpc/${path}`, init);
}

function query(path: string, requestHeaders: HeadersInit = headers) {
  return request(path, { headers: requestHeaders });
}

function mutation(path: string, input: unknown) {
  return request(path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

describe("private durable manager service", () => {
  it("rejects missing or invalid hosted configuration before accepting requests", () => {
    const { storage } = setup();
    for (const invalid of [
      {},
      { MANAGER_SERVICE_TOKEN: "short", MANAGER_OWNER_ID: owner },
      { MANAGER_SERVICE_TOKEN: token },
      { MANAGER_SERVICE_TOKEN: token, MANAGER_OWNER_ID: "0" },
      { MANAGER_SERVICE_TOKEN: token, MANAGER_OWNER_ID: "not-a-number" },
    ]) {
      expect(() => new DurableManagerObject({ storage }, invalid)).toThrow(
        "Hosted manager service authentication is not configured.",
      );
    }
  });

  it("rejects absent, incorrect, ambiguous, and browser-origin credentials", async () => {
    const { service } = setup();
    const variants: HeadersInit[] = [
      {},
      { "x-manager-actor": owner },
      { authorization: `Bearer ${token}` },
      { ...headers, authorization: `Bearer ${token}wrong` },
      { ...headers, authorization: `bearer ${token}` },
      { ...headers, "x-manager-actor": "999999" },
      { ...headers, origin: "https://untrusted.example" },
      { ...headers, origin: "null" },
      [
        ["authorization", `Bearer ${token}`],
        ["authorization", `Bearer ${token}`],
        ["x-manager-actor", owner],
      ],
      [
        ["authorization", `Bearer ${token}`],
        ["x-manager-actor", owner],
        ["x-manager-actor", owner],
      ],
    ];
    for (const variant of variants) {
      const response = await service.fetch(query("projects.list", variant));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain(token);
    }
  });

  it("serves only configuration status to the authorized service", async () => {
    const { service } = setup();
    const response = await service.fetch(query("agent.configuration"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      result: {
        data: {
          evidence: "unconfigured",
          model: "unconfigured",
          intake: "unconfigured",
          conversation: "unconfigured",
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it("persists projects across requests and reconstruction from the same durable storage", async () => {
    const { service, storage } = setup();
    const create = await service.fetch(
      mutation("projects.create", { name: "Synthetic project" }),
    );
    expect(create.status).toBe(200);
    const created = (await create.json()).result.data;
    expect(created).toMatchObject({ name: "Synthetic project", revision: 0 });

    const listed = await service.fetch(query("projects.list"));
    expect((await listed.json()).result.data).toEqual([created]);
    const reopened = new DurableManagerObject({ storage }, env);
    const afterRestart = await reopened.fetch(query("projects.list"));
    expect(afterRestart.status).toBe(200);
    expect((await afterRestart.json()).result.data).toEqual([created]);
  });

  it("refuses note intake and conversation without recording runs or notes", async () => {
    const { service } = setup();
    const create = await service.fetch(
      mutation("projects.create", { name: "Synthetic project" }),
    );
    const project = (await create.json()).result.data;
    const intake = await service.fetch(
      mutation("notes.submit", {
        projectId: project.id,
        sourceId: "fixture",
        sourceVersion: "1",
        markdown: "Synthetic note",
      }),
    );
    expect(intake.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await intake.json())).toMatch(/unavailable/i);
    const conversation = await service.fetch(
      mutation("conversations.send", {
        projectId: project.id,
        question: "What is next?",
      }),
    );
    expect(conversation.status).toBeGreaterThanOrEqual(400);
    const current = await service.fetch(
      query(
        `projects.get?input=${encodeURIComponent(JSON.stringify({ projectId: project.id }))}`,
      ),
    );
    expect((await current.json()).result.data).toMatchObject({
      notes: [],
      conversations: [],
    });
    const runs = await service.fetch(
      query(
        `runs.list?input=${encodeURIComponent(JSON.stringify({ projectId: project.id }))}`,
      ),
    );
    expect((await runs.json()).result.data).toEqual([]);
  });
});
