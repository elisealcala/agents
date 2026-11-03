/** Versioned, integrity-checked snapshots for an offline, explicitly quiesced cutover. */
import { createHash } from "node:crypto";

type Value = string | number | null;
type Driver = {
  prepare(query: string): {
    all(...args: Value[]): unknown[];
    get(...args: Value[]): unknown;
    run(...args: Value[]): unknown;
  };
  transaction<T>(operation: () => T): T;
};
type Kind = "manager" | "evidence";
type Table = {
  name: string;
  columns: readonly string[];
  order: readonly string[];
};
const tables: Record<Kind, readonly Table[]> = {
  manager: [
    { name: "projects", columns: ["id", "data"], order: ["id"] },
    { name: "runs", columns: ["id", "data"], order: ["id"] },
    { name: "evaluations", columns: ["id", "data"], order: ["id"] },
    {
      name: "delivery_repositories",
      columns: ["id", "identity", "revision", "status"],
      order: ["id"],
    },
    {
      name: "delivery_outbox",
      columns: [
        "id",
        "repository_id",
        "operation_key",
        "kind",
        "revision",
        "status",
        "attempt_id",
        "lease_expires_at",
      ],
      order: ["id"],
    },
    {
      name: "delivery_work_items",
      columns: ["repository_id", "issue_number", "revision", "data"],
      order: ["repository_id", "issue_number"],
    },
    {
      name: "delivery_jobs",
      columns: [
        "id",
        "repository_id",
        "kind",
        "status",
        "attempt_id",
        "lease_expires_at",
      ],
      order: ["id"],
    },
  ],
  evidence: [
    {
      name: "project_evidence",
      columns: [
        "document_ref",
        "project_id",
        "source_id",
        "source_version",
        "checksum",
        "markdown",
        "source_date",
        "audit_id",
        "error",
        "created_at",
      ],
      order: ["document_ref"],
    },
    {
      name: "project_evidence_keys",
      columns: ["idempotency_key", "document_ref"],
      order: ["idempotency_key"],
    },
    {
      name: "project_evidence_chunks",
      columns: [
        "document_ref",
        "start_offset",
        "end_offset",
        "embedding_json",
        "embedding_provider",
      ],
      order: ["document_ref", "start_offset"],
    },
  ],
};
// Declared column types, nullability and keys must match the schemas used by the stores.
const schemaRules: Record<
  string,
  {
    types: string;
    nullable: string[];
    pk: string[];
    unique: string[][];
    foreign: string[][];
  }
> = {
  projects: {
    types: "TT",
    nullable: ["id"],
    pk: ["id"],
    unique: [["id"]],
    foreign: [],
  },
  runs: {
    types: "TT",
    nullable: ["id"],
    pk: ["id"],
    unique: [["id"]],
    foreign: [],
  },
  evaluations: {
    types: "TT",
    nullable: ["id"],
    pk: ["id"],
    unique: [["id"]],
    foreign: [],
  },
  manager_migrations: {
    types: "I",
    nullable: ["version"],
    pk: ["version"],
    unique: [],
    foreign: [],
  },
  delivery_repositories: {
    types: "TTIT",
    nullable: ["id"],
    pk: ["id"],
    unique: [["id"]],
    foreign: [],
  },
  delivery_outbox: {
    types: "TTTTITTT",
    nullable: ["id", "attempt_id", "lease_expires_at"],
    pk: ["id"],
    unique: [["id"], ["operation_key"]],
    foreign: [["delivery_repositories", "repository_id", "id"]],
  },
  delivery_work_items: {
    types: "TIIT",
    nullable: [],
    pk: ["repository_id", "issue_number"],
    unique: [["repository_id", "issue_number"]],
    foreign: [["delivery_repositories", "repository_id", "id"]],
  },
  delivery_jobs: {
    types: "TTTTTT",
    nullable: ["id", "attempt_id", "lease_expires_at"],
    pk: ["id"],
    unique: [["id"]],
    foreign: [["delivery_repositories", "repository_id", "id"]],
  },
  project_evidence: {
    types: "TTTTTTTITT",
    nullable: ["document_ref", "source_date", "audit_id", "error"],
    pk: ["document_ref"],
    unique: [["document_ref"], ["project_id", "source_id", "source_version"]],
    foreign: [],
  },
  project_evidence_keys: {
    types: "TT",
    nullable: ["idempotency_key"],
    pk: ["idempotency_key"],
    unique: [["idempotency_key"]],
    foreign: [["project_evidence", "document_ref", "document_ref"]],
  },
  project_evidence_chunks: {
    types: "TIITT",
    nullable: ["embedding_json", "embedding_provider"],
    pk: ["document_ref", "start_offset"],
    unique: [["document_ref", "start_offset"]],
    foreign: [["project_evidence", "document_ref", "document_ref"]],
  },
};
const sortedRules = (rules: string[][]) =>
  rules.map((rule) => JSON.stringify(rule)).sort();
function assertConstraints(driver: Driver, table: Table): void {
  const rule = schemaRules[table.name];
  const columns = driver.prepare(`PRAGMA table_info(${table.name})`).all() as {
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }[];
  const expected = table.columns.map((name, i) => [
    name,
    rule.types[i] === "I" ? "INTEGER" : "TEXT",
    rule.nullable.includes(name) ? 0 : 1,
    rule.pk.indexOf(name) + 1,
  ]);
  if (
    JSON.stringify(
      columns.map((c) => [c.name, c.type.toUpperCase(), c.notnull, c.pk]),
    ) !== JSON.stringify(expected)
  )
    throw new Error(`Unsupported constraints for ${table.name}`);
  const foreign = driver
    .prepare(`PRAGMA foreign_key_list(${table.name})`)
    .all() as {
    table: string;
    from: string;
    to: string;
    on_update: string;
    on_delete: string;
    seq: number;
  }[];
  if (
    foreign.some(
      (key) =>
        key.seq !== 0 ||
        key.on_update !== "NO ACTION" ||
        key.on_delete !== "NO ACTION",
    ) ||
    JSON.stringify(
      sortedRules(foreign.map((key) => [key.table, key.from, key.to])),
    ) !== JSON.stringify(sortedRules(rule.foreign))
  )
    throw new Error(`Unsupported foreign keys for ${table.name}`);
  const indexes = driver.prepare(`PRAGMA index_list(${table.name})`).all() as {
    name: string;
    unique: number;
    partial: number;
  }[];
  const unique = indexes
    .filter((index) => index.unique)
    .map((index) => {
      if (!/^[A-Za-z0-9_]+$/.test(index.name) || index.partial)
        throw new Error(`Unsupported index for ${table.name}`);
      return (
        driver.prepare(`PRAGMA index_info(${index.name})`).all() as {
          name: string;
        }[]
      ).map((column) => column.name);
    });
  if (
    JSON.stringify(sortedRules(unique)) !==
    JSON.stringify(sortedRules(rule.unique))
  )
    throw new Error(`Unsupported unique keys for ${table.name}`);
}
type Payload = {
  version: 1;
  kind: Kind;
  tables: { name: string; rows: Value[][] }[];
};
export type Snapshot = Payload & { sha256: string };
const digest = (payload: Payload) =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");
function assertSchema(driver: Driver, kind: Kind): void {
  for (const table of tables[kind]) {
    const actual = driver.prepare(`PRAGMA table_info(${table.name})`).all() as {
      name: unknown;
    }[];
    if (
      JSON.stringify(actual.map((column) => column.name)) !==
      JSON.stringify(table.columns)
    )
      throw new Error(`Unsupported schema for ${table.name}`);
    assertConstraints(driver, table);
  }
  if (kind === "manager") {
    assertConstraints(driver, {
      name: "manager_migrations",
      columns: ["version"],
      order: ["version"],
    });
    const actualTables = driver
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) != 'sqlite_' AND name NOT IN ('__cf_kv', '_cf_KV', '_cf_METADATA', '__miniflare_do_name') ORDER BY name",
      )
      .all() as { name: unknown }[];
    const expectedTables = [
      ...tables.manager.map((table) => table.name),
      "manager_migrations",
    ].sort();
    if (
      JSON.stringify(actualTables.map((row) => row.name)) !==
      JSON.stringify(expectedTables)
    )
      throw new Error("Unsupported manager tables");
    const versions = driver
      .prepare("SELECT version FROM manager_migrations ORDER BY version")
      .all() as { version: unknown }[];
    if (JSON.stringify(versions.map((row) => row.version)) !== "[1,2]")
      throw new Error("Unsupported manager migration version");
  }
}
function validValue(value: unknown): value is Value {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}
function checkEvidence(rows: Value[][]): void {
  for (const row of rows) {
    const checksum = row[4];
    const markdown = row[5];
    if (
      typeof checksum !== "string" ||
      typeof markdown !== "string" ||
      Buffer.from(markdown, "utf8").toString("utf8") !== markdown ||
      createHash("sha256").update(markdown, "utf8").digest("hex") !== checksum
    )
      throw new Error("Evidence checksum mismatch");
  }
}
function validate(snapshot: Snapshot): Payload {
  if (
    snapshot?.version !== 1 ||
    (snapshot.kind !== "manager" && snapshot.kind !== "evidence") ||
    !Array.isArray(snapshot.tables)
  )
    throw new Error("Unsupported snapshot");
  const schema = tables[snapshot.kind];
  if (snapshot.tables.length !== schema.length)
    throw new Error("Invalid snapshot tables");
  const data = snapshot.tables.map((table, i) => {
    if (
      !table ||
      table.name !== schema[i].name ||
      !Array.isArray(table.rows) ||
      table.rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== schema[i].columns.length ||
          !row.every(validValue),
      )
    )
      throw new Error("Invalid snapshot rows");
    return { name: table.name, rows: table.rows };
  });
  const payload: Payload = { version: 1, kind: snapshot.kind, tables: data };
  if (snapshot.sha256 !== digest(payload))
    throw new Error("Snapshot checksum mismatch");
  if (snapshot.kind === "evidence") checkEvidence(data[0].rows);
  return payload;
}
/** Caller must stop all writers across both stores before taking a matching pair. */
export function captureSnapshot(driver: Driver, kind: Kind): Snapshot {
  return driver.transaction(() => {
    assertSchema(driver, kind);
    if (driver.prepare("PRAGMA foreign_key_check").all().length !== 0)
      throw new Error("Source database violates foreign keys");
    const payload: Payload = {
      version: 1,
      kind,
      tables: tables[kind].map((table) => ({
        name: table.name,
        rows: driver
          .prepare(
            `SELECT ${table.columns.join(", ")} FROM ${table.name} ORDER BY ${table.order.join(", ")}`,
          )
          .all()
          .map((row) => {
            const record = row as Record<string, unknown>;
            const values = table.columns.map((column) => record[column]);
            if (!values.every(validValue))
              throw new Error(`Unsupported value in ${table.name}`);
            return values;
          }),
      })),
    };
    const snapshot = { ...payload, sha256: digest(payload) };
    validate(snapshot);
    return snapshot;
  });
}
/** Restore only into a freshly initialized, empty database; never overwrite existing state. */
export function restoreSnapshot(driver: Driver, snapshot: Snapshot): void {
  const payload = validate(snapshot);
  driver.transaction(() => {
    assertSchema(driver, payload.kind);
    for (const table of tables[payload.kind]) {
      const result = driver
        .prepare(`SELECT COUNT(*) AS count FROM ${table.name}`)
        .get() as { count: number };
      if (result.count !== 0)
        throw new Error(`Destination ${table.name} is not empty`);
    }
    for (const [i, table] of tables[payload.kind].entries()) {
      const insert = driver.prepare(
        `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES (${table.columns.map(() => "?").join(", ")})`,
      );
      for (const row of payload.tables[i].rows) insert.run(...row);
    }
    if (driver.prepare("PRAGMA foreign_key_check").all().length !== 0)
      throw new Error("Restored snapshot violates foreign keys");
    const after = captureRows(driver, payload.kind);
    if (
      digest({ version: 1, kind: payload.kind, tables: after }) !==
      snapshot.sha256
    )
      throw new Error("Restored snapshot differs from source");
  });
}
function captureRows(driver: Driver, kind: Kind): Payload["tables"] {
  return tables[kind].map((table) => ({
    name: table.name,
    rows: driver
      .prepare(
        `SELECT ${table.columns.join(", ")} FROM ${table.name} ORDER BY ${table.order.join(", ")}`,
      )
      .all()
      .map((row) =>
        table.columns.map((column) => (row as Record<string, Value>)[column]),
      ),
  }));
}

/** Check every persisted note reference against the matching immutable source snapshot. */
export function validateSnapshotPair(
  manager: Snapshot,
  evidence: Snapshot,
): void {
  const managerData = validate(manager);
  const evidenceData = validate(evidence);
  if (managerData.kind !== "manager" || evidenceData.kind !== "evidence")
    throw new Error("Expected manager and evidence snapshots");
  const sources = new Map(
    evidenceData.tables[0].rows.map((row) => [row[0], row]),
  );
  for (const [id, data] of managerData.tables[0].rows) {
    if (typeof id !== "string" || typeof data !== "string")
      throw new Error("Invalid project record");
    const project: unknown = JSON.parse(data);
    if (
      !project ||
      typeof project !== "object" ||
      !("id" in project) ||
      project.id !== id ||
      !("notes" in project) ||
      !Array.isArray(project.notes)
    )
      throw new Error("Invalid project record");
    for (const note of project.notes as unknown[]) {
      if (!note || typeof note !== "object" || !("documentRef" in note))
        throw new Error("Invalid project note");
      if (note.documentRef === null) continue;
      if (typeof note.documentRef !== "string")
        throw new Error("Invalid evidence reference");
      const source = sources.get(note.documentRef);
      if (
        !source ||
        source[1] !== id ||
        !("sourceId" in note) ||
        source[2] !== note.sourceId ||
        !("sourceVersion" in note) ||
        source[3] !== note.sourceVersion ||
        !("checksum" in note) ||
        source[4] !== note.checksum ||
        !("sourceDate" in note) ||
        source[6] !== note.sourceDate ||
        !("markdown" in note) ||
        source[5] !== note.markdown
      )
        throw new Error("Project note and evidence do not match");
    }
  }
}
