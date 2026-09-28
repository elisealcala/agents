/**
 * Validated input and output contracts shared by the CLI and the MCP server.
 *
 * Every named type here is a wire contract: it crosses the process boundary to
 * a supervisor, so the Zod schema and the TypeScript type are written out
 * separately and checked against each other. `snake_case` fields are model or
 * SQLite wire formats and are deliberate — see DEC-017.
 */
import { z } from "zod";

const text = z.string().min(1);
const inputText = z.string().trim().min(1);
const score = z.number().min(0).max(1);
const count = z.number().int().nonnegative();

/** A live taxonomy category as reported to callers. */
export type CategoryRecord = {
  id: string;
  name: string;
  definition: string;
  folder: string;
  embedding: number[] | null;
  embeddingProvider: string | null;
  isSeed: boolean;
  createdAt: string;
};

const category: z.ZodType<CategoryRecord> = z.object({
  id: text,
  name: text,
  definition: text,
  folder: text,
  embedding: z.array(z.number()).nullable(),
  embeddingProvider: z.string().nullable(),
  isSeed: z.boolean(),
  createdAt: z.string(),
});

/**
 * Fields every classification carries, whatever the model decided to do.
 *
 * `confidence_score` is the model's certainty about the note itself;
 * `fit_score` is how well the chosen category covers it. They are distinct on
 * purpose — see DEC-007.
 */
export type ClassificationDetails = {
  summary: string;
  tags: string[];
  confidence_score: number;
  fit_score: number;
};

const details = {
  summary: text,
  tags: z.array(text),
  confidence_score: score,
  fit_score: score,
};

/** What the model decided: file under a live category, or propose a new one. */
export type ReportedClassification =
  | ({ action: "existing"; category: string } & ClassificationDetails)
  | ({
      action: "propose";
      proposal: { name: string; definition: string };
    } & ClassificationDetails);

const classification: z.ZodType<ReportedClassification> = z.discriminatedUnion(
  "action",
  [
    z.object({ action: z.literal("existing"), category: text, ...details }),
    z.object({
      action: z.literal("propose"),
      proposal: z.object({ name: text, definition: text }),
      ...details,
    }),
  ],
);

/**
 * The outcome for a single inbox file.
 *
 * `failed` and `skipped` both leave the file in the inbox; only `ok` means it
 * moved. Callers inspecting a partial batch must read every entry.
 */
export type ReportedProcessResult =
  | {
      status: "ok";
      sourcePath: string;
      destinationPath: string;
      category: CategoryRecord;
      classification: ReportedClassification;
      categoryAction: "existing" | "merged" | "created";
    }
  | { status: "failed"; sourcePath: string; error: string }
  | { status: "skipped"; sourcePath: string; reason: string };

export const processResultSchema: z.ZodType<ReportedProcessResult> =
  z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      sourcePath: text,
      destinationPath: text,
      category,
      classification,
      categoryAction: z.enum(["existing", "merged", "created"]),
    }),
    z.object({
      status: z.literal("failed"),
      sourcePath: text,
      error: z.string(),
    }),
    z.object({
      status: z.literal("skipped"),
      sourcePath: text,
      reason: z.string(),
    }),
  ]);

/** Per-status tallies for one ingestion batch. `total` counts every file seen. */
export type IngestCounts = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

/** The result of one `ingest_inbox` call: every file, plus the tallies. */
export type IngestReport = {
  results: ReportedProcessResult[];
  counts: IngestCounts;
};

export const ingestReportSchema: z.ZodType<IngestReport> = z.object({
  results: z.array(processResultSchema),
  counts: z.object({
    total: count,
    succeeded: count,
    failed: count,
    skipped: count,
  }),
});

/** One retrieved excerpt. `score` is cosine similarity, so it may be negative. */
export type SourceExcerpt = { path: string; score: number; snippet: string };

const source: z.ZodType<SourceExcerpt> = z.object({
  path: text,
  score: z.number(),
  snippet: z.string(),
});

/** Retrieval hits with their stored summaries, and no model completion. */
export type SearchReport = {
  sources: (SourceExcerpt & { summary: string })[];
};

export const searchReportSchema: z.ZodType<SearchReport> = z.object({
  sources: z.array(
    z.object({
      path: text,
      score: z.number(),
      snippet: z.string(),
      summary: z.string(),
    }),
  ),
});

/** A grounded answer. An empty `sources` array means nothing relevant was found. */
export type AnswerReport = { answer: string; sources: SourceExcerpt[] };

export const answerSchema: z.ZodType<AnswerReport> = z.object({
  answer: z.string(),
  sources: z.array(source),
});

/** One stored piece of human feedback. Recording it never moves the file. */
export type CorrectionRecord = {
  id: number;
  originalPath: string;
  wrongCategory: string;
  correctCategory: string;
  note: string | null;
  createdAt: string;
};

export const correctionSchema: z.ZodType<CorrectionRecord> = z.object({
  id: count,
  originalPath: text,
  wrongCategory: text,
  correctCategory: text,
  note: z.string().nullable(),
  createdAt: z.string(),
});

/** One side of a proposed split, described by its most common tags. */
export type ClusterSummary = {
  label: string;
  documentCount: number;
  exampleFiles: string[];
};

const cluster: z.ZodType<ClusterSummary> = z.object({
  label: z.string(),
  documentCount: count,
  exampleFiles: z.array(z.string()),
});

/**
 * A suggestion that one category holds two distinct themes.
 *
 * `separation` is how far apart the two cluster centroids sit. This is advice
 * only: nothing is moved and no folder is created — see DEC-011.
 */
export type SplitSuggestion = {
  action: "split";
  categoryId: string;
  reason: string;
  separation: number;
  clusters: [ClusterSummary, ClusterSummary];
};

/** Every split worth a human's attention, for one clustering pass. */
export type ClusteringReport = {
  generatedAt: string;
  examinedCategories: number;
  suggestions: SplitSuggestion[];
};

export const clusteringReportSchema: z.ZodType<ClusteringReport> = z.object({
  generatedAt: z.string(),
  examinedCategories: count,
  suggestions: z.array(
    z.object({
      action: z.literal("split"),
      categoryId: text,
      reason: z.string(),
      separation: z.number(),
      clusters: z.tuple([cluster, cluster]),
    }),
  ),
});

/**
 * Counts from one embedding repair pass.
 *
 * `created` is a first embedding, `repaired` replaces a `missing` row. A
 * non-zero `failed` downgrades the operation to `partial`.
 */
export type EmbeddingBackfillReport = {
  examined: number;
  created: number;
  repaired: number;
  failed: number;
};

export const backfillReportSchema: z.ZodType<EmbeddingBackfillReport> =
  z.object({
    examined: count,
    created: count,
    repaired: count,
    failed: count,
  });

/** Tools that take no arguments still validate, so stray keys are rejected. */
export type EmptyInput = Record<string, never>;

export const emptyInputSchema: z.ZodType<EmptyInput> = z.strictObject({});

/** Input for both `search_documents` and `ask_question`. */
export type QuestionInput = {
  question: string;
  topK?: number;
  minimumScore?: number;
};

export const questionInputSchema: z.ZodType<QuestionInput> = z.strictObject({
  question: inputText,
  topK: z.number().int().positive().optional(),
  minimumScore: z.number().min(-1).max(1).optional(),
});

/** Input for `record_correction`. Categories are names, not folder paths. */
export type CorrectionInput = {
  originalPath: string;
  wrongCategory: string;
  correctCategory: string;
  note?: string;
};

export const correctionInputSchema: z.ZodType<CorrectionInput> = z.strictObject(
  {
    originalPath: inputText,
    wrongCategory: inputText,
    correctCategory: inputText,
    note: z.string().optional(),
  },
);

/** Input for `suggest_category_splits`. */
export type ClusterInput = { minimumCategorySize?: number };

export const clusterInputSchema: z.ZodType<ClusterInput> = z.strictObject({
  minimumCategorySize: z.number().int().positive().optional(),
});

/**
 * Why an operation did not fully succeed.
 *
 * `LIBRARY_BUSY` and `INCOMPLETE` are expected outcomes a supervisor should
 * handle, not defects: the first means another run owns the library, the
 * second that some files in a batch failed.
 */
export type OperationError = {
  code:
    | "INVALID_INPUT"
    | "INVALID_OUTPUT"
    | "MODEL_CONFIGURATION"
    | "LIBRARY_BUSY"
    | "OPERATION_FAILED"
    | "INCOMPLETE"
    | "APPLICATION_CLOSED";
  message: string;
};

export const operationErrorSchema: z.ZodType<OperationError> = z.object({
  code: z.enum([
    "INVALID_INPUT",
    "INVALID_OUTPUT",
    "MODEL_CONFIGURATION",
    "LIBRARY_BUSY",
    "OPERATION_FAILED",
    "INCOMPLETE",
    "APPLICATION_CLOSED",
  ]),
  message: z.string(),
});

/**
 * The envelope every operation returns.
 *
 * The three arms encode what the caller may rely on:
 * - `success` always carries data and never an error.
 * - `partial` always carries both: some work landed, some did not.
 * - `error` always carries an error, and carries data only for a batch in
 *   which every item failed — {@link batchResult} still reports what it tried.
 *
 * So a non-`success` status always has a readable `error`, and callers never
 * need a fallback code.
 */
export type OperationResult<T> =
  | { status: "success"; data: T; error: null }
  | { status: "partial"; data: T; error: OperationError }
  | { status: "error"; data: T | null; error: OperationError };

/**
 * Builds the schema advertised as an MCP tool's `outputSchema`.
 *
 * The cast is needed because Zod cannot prove a union built from a generic
 * member schema matches the generic {@link OperationResult}; the three arms
 * below are written to match it exactly.
 */
export function resultSchema<T extends z.ZodType>(
  data: T,
): z.ZodType<OperationResult<z.infer<T>>> {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("success"), data, error: z.null() }),
    z.object({
      status: z.literal("partial"),
      data,
      error: operationErrorSchema,
    }),
    z.object({
      status: z.literal("error"),
      data: data.nullable(),
      error: operationErrorSchema,
    }),
  ]) as unknown as z.ZodType<OperationResult<z.infer<T>>>;
}

/**
 * An error that carries an {@link OperationError} code out of deep call stacks.
 *
 * Anything else thrown inside an operation is reported as `OPERATION_FAILED`.
 */
export class OperationFailure extends Error {
  constructor(
    readonly code: OperationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "OperationFailure";
  }
}

/** A failed operation with no data to report. */
export function failure<T>(
  code: OperationError["code"],
  message: string,
): OperationResult<T> {
  return { status: "error", data: null, error: { code, message } };
}

/** A fully successful operation. */
export function success<T>(data: T): OperationResult<T> {
  return { status: "success", data, error: null };
}

/**
 * Grades a batch by how much of it landed.
 *
 * All succeeded is `success`; a mix is `partial`; none succeeded is `error`.
 * The `error` case still returns the report, because the caller needs to see
 * which files failed and whether any were already moved.
 */
export function batchResult<T>(
  data: T,
  succeeded: number,
  failed: number,
): OperationResult<T> {
  if (!failed) return success(data);
  const error: OperationError = {
    code: "INCOMPLETE",
    message: `${failed} item(s) failed; inspect the report before retrying.`,
  };
  if (succeeded > 0) return { status: "partial", data, error };
  return { status: "error", data, error };
}
