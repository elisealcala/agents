import { z } from "zod";

const text = z.string().min(1);
const inputText = z.string().trim().min(1);
const score = z.number().min(0).max(1);
const count = z.number().int().nonnegative();
const category = z.object({
  id: text,
  name: text,
  definition: text,
  folder: text,
  embedding: z.array(z.number()).nullable(),
  embeddingProvider: z.string().nullable(),
  isSeed: z.boolean(),
  createdAt: z.string(),
});
const details = {
  summary: text,
  tags: z.array(text),
  confidence_score: score,
  fit_score: score,
};
const classification = z.discriminatedUnion("action", [
  z.object({ action: z.literal("existing"), category: text, ...details }),
  z.object({
    action: z.literal("propose"),
    proposal: z.object({ name: text, definition: text }),
    ...details,
  }),
]);
export const processResultSchema = z.discriminatedUnion("status", [
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
export const ingestReportSchema = z.object({
  results: z.array(processResultSchema),
  counts: z.object({
    total: count,
    succeeded: count,
    failed: count,
    skipped: count,
  }),
});
const source = z.object({ path: text, score: z.number(), snippet: z.string() });
export const searchReportSchema = z.object({
  sources: z.array(source.extend({ summary: z.string() })),
});
export const answerSchema = z.object({
  answer: z.string(),
  sources: z.array(source),
});
export const correctionSchema = z.object({
  id: count,
  originalPath: text,
  wrongCategory: text,
  correctCategory: text,
  note: z.string().nullable(),
  createdAt: z.string(),
});
const cluster = z.object({
  label: z.string(),
  documentCount: count,
  exampleFiles: z.array(z.string()),
});
export const clusteringReportSchema = z.object({
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
export const backfillReportSchema = z.object({
  examined: count,
  created: count,
  repaired: count,
  failed: count,
});
export const emptyInputSchema = z.strictObject({});
export const questionInputSchema = z.strictObject({
  question: inputText,
  topK: z.number().int().positive().optional(),
  minimumScore: z.number().min(-1).max(1).optional(),
});
export const correctionInputSchema = z.strictObject({
  originalPath: inputText,
  wrongCategory: inputText,
  correctCategory: inputText,
  note: z.string().optional(),
});
export const clusterInputSchema = z.strictObject({
  minimumCategorySize: z.number().int().positive().optional(),
});
export const operationErrorSchema = z.object({
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
export type OperationError = z.infer<typeof operationErrorSchema>;
export type OperationResult<T> = {
  status: "success" | "partial" | "error";
  data: T | null;
  error: OperationError | null;
};
export function resultSchema<T extends z.ZodType>(data: T) {
  return z.object({
    status: z.enum(["success", "partial", "error"]),
    data: data.nullable(),
    error: operationErrorSchema.nullable(),
  });
}
export type IngestReport = z.infer<typeof ingestReportSchema>;
export type QuestionInput = z.infer<typeof questionInputSchema>;
export type CorrectionInput = z.infer<typeof correctionInputSchema>;
export type ClusterInput = z.infer<typeof clusterInputSchema>;
export type SearchReport = z.infer<typeof searchReportSchema>;

export class OperationFailure extends Error {
  constructor(
    readonly code: OperationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "OperationFailure";
  }
}
export function failure<T>(
  code: OperationError["code"],
  message: string,
): OperationResult<T> {
  return { status: "error", data: null, error: { code, message } };
}
export function success<T>(data: T): OperationResult<T> {
  return { status: "success", data, error: null };
}
export function batchResult<T>(
  data: T,
  succeeded: number,
  failed: number,
): OperationResult<T> {
  if (!failed) return success(data);
  return {
    status: succeeded > 0 ? "partial" : "error",
    data,
    error: {
      code: "INCOMPLETE",
      message: `${failed} item(s) failed; inspect the report before retrying.`,
    },
  };
}
