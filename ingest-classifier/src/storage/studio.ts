/**
 * Studio runs, spans, and library-scoped settings.
 *
 * These tables live in the same SQLite file as the classifier's audit and
 * corrections. The CLI never opens this store. A missing row means "use the
 * built-in default".
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SpanKind, TraceObserver } from "../observability/trace.ts";

/** A studio run's terminal status matches an operation result. */
export type StudioRunStatus = "running" | "success" | "partial" | "error";

/** One started or finished studio run. */
export type StudioRun = {
  id: string;
  action: string;
  status: StudioRunStatus;
  input: unknown;
  output: unknown;
  error: { code: string; message: string } | null;
  startedAt: string;
  endedAt: string | null;
};

/** One span in a run. `running` spans have no `endedAt`. */
export type StudioSpan = {
  id: string;
  runId: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  status: "running" | "ok" | "failed";
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
};

/** Overrides saved from the studio. Null means the built-in default. */
export type StudioSettings = {
  fitThreshold: number | null;
  dedupThreshold: number | null;
  exampleLimit: number | null;
  promptTemplate: string | null;
};

type SpanListener = (span: StudioSpan) => void;

const SETTING_KEYS = [
  "fitThreshold",
  "dedupThreshold",
  "exampleLimit",
  "promptTemplate",
] as const;

/** Persists runs and settings, and is the trace observer for one process. */
export class StudioStore {
  private readonly db: DatabaseSync;
  private readonly listeners = new Map<string, Set<SpanListener>>();

  constructor(databasePath: string) {
    const absolute = path.resolve(databasePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    try {
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  /** Read overrides. Every field is null until the studio saves one. */
  readSettings(): StudioSettings {
    const rows = this.db
      .prepare("SELECT key, value_json FROM studio_settings")
      .all() as Array<{ key: string; value_json: string }>;
    const settings: StudioSettings = {
      fitThreshold: null,
      dedupThreshold: null,
      exampleLimit: null,
      promptTemplate: null,
    };
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      settings[row.key] = JSON.parse(row.value_json) as never;
    }
    return settings;
  }

  /** Replace one override. Pass null to restore the built-in default. */
  writeSetting<K extends keyof StudioSettings>(
    key: K,
    value: StudioSettings[K],
  ): void {
    if (value === null) {
      this.db.prepare("DELETE FROM studio_settings WHERE key = ?").run(key);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO studio_settings (key, value_json)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
      )
      .run(key, JSON.stringify(value));
  }

  /** Open a run. The caller executes the action and then {@link finishRun}. */
  openRun(action: string, input: unknown): StudioRun {
    const run: StudioRun = {
      id: randomUUID(),
      action,
      status: "running",
      input,
      output: null,
      error: null,
      startedAt: now(),
      endedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO studio_runs
          (id, action, status, input_json, output_json, error_json, started_at, ended_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)`,
      )
      .run(
        run.id,
        run.action,
        run.status,
        JSON.stringify(input),
        run.startedAt,
      );
    return run;
  }

  /** Store the operation result and close the run. */
  finishRun(
    id: string,
    result: {
      status: "success" | "partial" | "error";
      output: unknown;
      error: { code: string; message: string } | null;
    },
  ): StudioRun {
    const endedAt = now();
    this.db
      .prepare(
        `UPDATE studio_runs
         SET status = ?, output_json = ?, error_json = ?, ended_at = ?
         WHERE id = ?`,
      )
      .run(
        result.status,
        JSON.stringify(result.output),
        result.error ? JSON.stringify(result.error) : null,
        endedAt,
        id,
      );
    const run = this.getRun(id);
    if (!run) throw new Error(`studio run ${id} disappeared`);
    return run;
  }

  /** Newest first. */
  listRuns(): StudioRun[] {
    const rows = this.db
      .prepare("SELECT * FROM studio_runs ORDER BY started_at DESC, id DESC")
      .all() as RunRow[];
    return rows.map(mapRun);
  }

  getRun(id: string): StudioRun | null {
    const row = this.db
      .prepare("SELECT * FROM studio_runs WHERE id = ?")
      .get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  /** Spans in the order they opened. */
  listSpans(runId: string): StudioSpan[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM studio_spans
         WHERE run_id = ?
         ORDER BY started_at, id`,
      )
      .all(runId) as SpanRow[];
    return rows.map(mapSpan);
  }

  /** Trace observer whose spans belong to one run and wake subscribers. */
  observer(runId: string): TraceObserver {
    return {
      start: (span) => {
        const record: StudioSpan = {
          id: randomUUID(),
          runId,
          parentId: span.parentId,
          name: span.name,
          kind: span.kind,
          status: "running",
          input: span.input ?? null,
          output: null,
          error: null,
          startedAt: now(),
          endedAt: null,
        };
        this.db
          .prepare(
            `INSERT INTO studio_spans
              (id, run_id, parent_id, name, kind, status, input_json, output_json, error, started_at, ended_at)
             VALUES (?, ?, ?, ?, ?, 'running', ?, NULL, NULL, ?, NULL)`,
          )
          .run(
            record.id,
            record.runId,
            record.parentId,
            record.name,
            record.kind,
            JSON.stringify(record.input),
            record.startedAt,
          );
        this.publish(record);
        return record.id;
      },
      end: (id, result) => {
        const endedAt = now();
        this.db
          .prepare(
            `UPDATE studio_spans
             SET status = ?, output_json = ?, error = ?, ended_at = ?
             WHERE id = ?`,
          )
          .run(
            result.status,
            JSON.stringify(result.output ?? null),
            result.error ?? null,
            endedAt,
            id,
          );
        const row = this.db
          .prepare("SELECT * FROM studio_spans WHERE id = ?")
          .get(id) as SpanRow | undefined;
        if (row) this.publish(mapSpan(row));
      },
    };
  }

  /** Hear span opens and closes for one run. The return value unsubscribes. */
  subscribe(runId: string, listener: SpanListener): () => void {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      set.delete(listener);
    };
  }

  private publish(span: StudioSpan): void {
    for (const listener of this.listeners.get(span.runId) ?? []) {
      listener(span);
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_runs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'success', 'partial', 'error')),
        input_json TEXT NOT NULL,
        output_json TEXT,
        error_json TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS studio_spans (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('action', 'stage', 'model', 'tool')),
        status TEXT NOT NULL CHECK(status IN ('running', 'ok', 'failed')),
        input_json TEXT,
        output_json TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS studio_spans_run ON studio_spans(run_id);
    `);
  }
}

function now(): string {
  return new Date().toISOString();
}

function isSettingKey(key: string): key is (typeof SETTING_KEYS)[number] {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

type RunRow = {
  id: string;
  action: string;
  status: StudioRunStatus;
  input_json: string;
  output_json: string | null;
  error_json: string | null;
  started_at: string;
  ended_at: string | null;
};

type SpanRow = {
  id: string;
  run_id: string;
  parent_id: string | null;
  name: string;
  kind: SpanKind;
  status: "running" | "ok" | "failed";
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
};

function mapRun(row: RunRow): StudioRun {
  return {
    id: row.id,
    action: row.action,
    status: row.status,
    input: JSON.parse(row.input_json) as unknown,
    output: row.output_json ? (JSON.parse(row.output_json) as unknown) : null,
    error: row.error_json
      ? (JSON.parse(row.error_json) as { code: string; message: string })
      : null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function mapSpan(row: SpanRow): StudioSpan {
  return {
    id: row.id,
    runId: row.run_id,
    parentId: row.parent_id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    input: row.input_json ? (JSON.parse(row.input_json) as unknown) : null,
    output: row.output_json ? (JSON.parse(row.output_json) as unknown) : null,
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}
