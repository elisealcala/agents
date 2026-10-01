/**
 * Classification against the five fixed seed categories.
 *
 * This is the fixed-taxonomy pipeline's classifier, kept for the zero-loss
 * evaluation. Production ingestion uses the adaptive classifier instead. The
 * model places the note through the organizer tools, and code still files a
 * low-confidence result under the fallback category (DEC-004, DEC-025).
 */
import type { ModelClient } from "../providers/types.ts";
import { DEFAULT_CLASSIFICATION_ATTEMPTS } from "../defaults.ts";
import {
  LOW_CONFIDENCE_FALLBACK,
  LOW_CONFIDENCE_THRESHOLD,
  SEED_CATEGORIES,
  isSeedCategoryId,
  type SeedCategoryId,
} from "../taxonomy/taxonomy.ts";
import {
  buildOrganizerSystemPrompt,
  placeNote,
  toolRecord,
} from "./organizer.ts";

export type Classification = {
  category: SeedCategoryId;
  summary: string;
  tags: string[];
  confidence_score: number;
  requested_category?: SeedCategoryId;
};

export type ClassifierOptions = {
  maxAttempts?: number;
};

export async function classifyFile(
  client: ModelClient,
  cleanText: string,
  options: ClassifierOptions = {},
): Promise<Classification> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_CLASSIFICATION_ATTEMPTS;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await placeNote(client, {
        system: buildClassificationPrompt(),
        user: cleanText,
        entries: SEED_CATEGORIES.map((category) => ({
          ...category,
          parentId: null,
        })),
        allowPropose: false,
        searchSimilar: async () => [],
        acceptExisting: acceptFixedPlacement,
      });
      return normalizeLowConfidence(result);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `classification failed schema validation after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

/** System prompt for the fixed-taxonomy organizer. The note is the user message. */
export function buildClassificationPrompt(): string {
  return buildOrganizerSystemPrompt({ allowPropose: false });
}

function acceptFixedPlacement(input: unknown): Classification {
  const record = toolRecord(input);
  return parseClassification(
    JSON.stringify({
      category: record.category,
      summary: record.summary,
      tags: record.tags,
      confidence_score: record.confidence_score,
    }),
  );
}

export function parseClassification(raw: string): Classification {
  const candidate = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    throw new Error("model reply is not valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("classification must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.category !== "string" ||
    !isSeedCategoryId(record.category)
  ) {
    throw new Error("category must be a seed category id");
  }
  if (typeof record.summary !== "string" || !record.summary.trim()) {
    throw new Error("summary must be a non-empty string");
  }
  if (
    !Array.isArray(record.tags) ||
    record.tags.some((tag) => typeof tag !== "string" || !tag.trim())
  ) {
    throw new Error("tags must be an array of non-empty strings");
  }
  if (
    typeof record.confidence_score !== "number" ||
    !Number.isFinite(record.confidence_score) ||
    record.confidence_score < 0 ||
    record.confidence_score > 1
  ) {
    throw new Error("confidence_score must be a number between 0 and 1");
  }

  return {
    category: record.category,
    summary: record.summary.trim(),
    tags: [...new Set(record.tags.map((tag) => tag.trim()))],
    confidence_score: record.confidence_score,
  };
}

function normalizeLowConfidence(result: Classification): Classification {
  if (result.confidence_score >= LOW_CONFIDENCE_THRESHOLD) return result;
  return {
    ...result,
    requested_category: result.category,
    category: LOW_CONFIDENCE_FALLBACK,
  };
}
