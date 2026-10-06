/** Immutable project evidence contracts, additive to the classifier API (DEC-028). */
import { z } from "zod";

/** Every search is bounded to this many source chunks. */
export const MAXIMUM_EVIDENCE_PASSAGES = 5;

export type EvidenceRef = {
  documentRef: string;
  projectId: string;
  sourceId: string;
  sourceVersion: string;
  checksum: string;
};

export type EvidenceSnapshot = EvidenceRef & {
  markdown: string;
  sourceDate: string | null;
};

export type EvidenceReceipt = EvidenceRef & {
  storageStatus: "stored" | "pending";
  indexStatus: "ready" | "missing";
  error: string | null;
};

/** Offsets are UTF-16 string offsets in the unchanged Markdown snapshot. */
export type EvidencePassage = EvidenceRef & {
  start: number;
  end: number;
  quote: string;
  score: number;
};

export type EvidenceSearchResult = {
  passages: EvidencePassage[];
  missingEmbeddings: number;
};

export type EvidenceIngestInput = {
  projectId: string;
  sourceId: string;
  sourceVersion: string;
  idempotencyKey: string;
  markdown: string;
  sourceDate?: string;
};

export type EvidenceReadInput = { projectId: string; documentRef: string };

export type EvidenceSearchInput = {
  projectId: string;
  question: string;
  topK?: number;
  minimumScore?: number;
};

const identifier = z.string().trim().min(1);
const reference = {
  documentRef: identifier,
  projectId: identifier,
  sourceId: identifier,
  sourceVersion: identifier,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
};

/** Markdown is deliberately not trimmed: checksum and source offsets preserve bytes. */
export const evidenceIngestInputSchema: z.ZodType<EvidenceIngestInput> =
  z.strictObject({
    projectId: identifier,
    sourceId: identifier,
    sourceVersion: identifier,
    idempotencyKey: identifier,
    markdown: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.from(value, "utf8").toString("utf8") === value,
        {
          message: "Markdown must contain valid Unicode",
        },
      ),
    sourceDate: z.iso.date().optional(),
  });

export const evidenceReadInputSchema: z.ZodType<EvidenceReadInput> =
  z.strictObject({ projectId: identifier, documentRef: identifier });

export const evidenceSearchInputSchema: z.ZodType<EvidenceSearchInput> =
  z.strictObject({
    projectId: identifier,
    question: identifier,
    topK: z.number().int().positive().max(MAXIMUM_EVIDENCE_PASSAGES).optional(),
    minimumScore: z.number().min(-1).max(1).optional(),
  });

export const evidenceSnapshotSchema: z.ZodType<EvidenceSnapshot> = z.object({
  ...reference,
  markdown: z.string(),
  sourceDate: z.string().nullable(),
});

export const evidenceReceiptSchema: z.ZodType<EvidenceReceipt> = z.object({
  ...reference,
  storageStatus: z.enum(["stored", "pending"]),
  indexStatus: z.enum(["ready", "missing"]),
  error: z.string().nullable(),
});

export const evidenceSearchResultSchema: z.ZodType<EvidenceSearchResult> =
  z.object({
    passages: z.array(
      z.object({
        ...reference,
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        quote: z.string(),
        score: z.number(),
      }),
    ),
    missingEmbeddings: z.number().int().nonnegative(),
  });
