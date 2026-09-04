import type { ModelClient } from "./providers/types.ts";
import {
  LOW_CONFIDENCE_FALLBACK,
  LOW_CONFIDENCE_THRESHOLD,
  SEED_CATEGORIES,
  isSeedCategoryId,
  type SeedCategoryId,
} from "./taxonomy.ts";

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
  const maxAttempts = options.maxAttempts ?? 2;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.complete(buildClassificationPrompt(cleanText));
      return normalizeLowConfidence(parseClassification(response));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `classification failed schema validation after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

export function buildClassificationPrompt(cleanText: string): string {
  const taxonomy = SEED_CATEGORIES.map(
    ({ id, name, definition }) => `- ${id} (${name}): ${definition}`,
  ).join("\n");

  return `You classify one Markdown note into exactly one seed category.

Seed categories:
${taxonomy}

Return JSON only with this exact shape:
{"category":"seed_id","summary":"one or two sentences","tags":["tag"],"confidence_score":0.0}

Rules:
- category must be a listed seed id.
- confidence_score must be between 0 and 1.
- tags must contain short strings.
- Do not wrap JSON in prose.

Note:
${cleanText}`;
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
  if (typeof record.category !== "string" || !isSeedCategoryId(record.category)) {
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
