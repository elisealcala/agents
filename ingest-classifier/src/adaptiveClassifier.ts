import type { ModelClient } from "./providers/types.ts";
import type { StoredCategory, CategoryProposal } from "./categories.ts";

export const EXISTING_CATEGORY_FIT_THRESHOLD = 0.8;

type ClassificationDetails = {
  summary: string;
  tags: string[];
  confidence_score: number;
  fit_score: number;
};

export type ExistingCategoryClassification = ClassificationDetails & {
  action: "existing";
  category: string;
};

export type ProposedCategoryClassification = ClassificationDetails & {
  action: "propose";
  proposal: CategoryProposal;
};

export type AdaptiveClassification =
  | ExistingCategoryClassification
  | ProposedCategoryClassification;

export async function classifyWithLiveTaxonomy(
  client: ModelClient,
  cleanText: string,
  categories: StoredCategory[],
  options: { maxAttempts?: number; examples?: string[] } = {},
): Promise<AdaptiveClassification> {
  const maxAttempts = options.maxAttempts ?? 2;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.complete(
        buildAdaptiveClassificationPrompt(cleanText, categories, options.examples ?? []),
      );
      return parseAdaptiveClassification(response, categories);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(
    `adaptive classification failed after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

export function buildAdaptiveClassificationPrompt(
  cleanText: string,
  categories: StoredCategory[],
  examples: string[] = [],
): string {
  const current = categories
    .map(({ id, name, definition }) => `- ${id} (${name}): ${definition}`)
    .join("\n");
  const fewShot = examples.length
    ? `\nCorrections to learn from:\n${examples.map((example) => `- ${example}`).join("\n")}\n`
    : "";
  return `Classify one note using the current live taxonomy.

Existing Categories:
${current}

Rule: If the note matches an existing category with fit_score > 0.80, return:
{"action":"existing","category":"category_id","summary":"one or two sentences","tags":["tag"],"confidence_score":0.0,"fit_score":0.0}

Otherwise return a proposed category without moving the file:
{"action":"propose","proposal":{"name":"Specific Category","definition":"One sentence defining the category."},"summary":"one or two sentences","tags":["tag"],"confidence_score":0.0,"fit_score":0.0}

Return JSON only. Scores must be between 0 and 1.${fewShot}
Note:
${cleanText}`;
}

export function parseAdaptiveClassification(
  raw: string,
  categories: StoredCategory[],
): AdaptiveClassification {
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
    throw new Error("adaptive classification must be an object");
  }
  const record = value as Record<string, unknown>;
  const details = parseDetails(record);
  if (record.action === "existing") {
    if (typeof record.category !== "string" || !categories.some(({ id }) => id === record.category)) {
      throw new Error("existing category must be a live category id");
    }
    if (details.fit_score <= EXISTING_CATEGORY_FIT_THRESHOLD) {
      throw new Error("existing category fit_score must be greater than 0.80");
    }
    return { action: "existing", category: record.category, ...details };
  }
  if (record.action === "propose") {
    if (details.fit_score > EXISTING_CATEGORY_FIT_THRESHOLD) {
      throw new Error("proposal fit_score must be at most 0.80");
    }
    if (!record.proposal || typeof record.proposal !== "object" || Array.isArray(record.proposal)) {
      throw new Error("proposal must contain a name and definition");
    }
    const proposal = record.proposal as Record<string, unknown>;
    if (typeof proposal.name !== "string" || !proposal.name.trim()) {
      throw new Error("proposal name must be non-empty");
    }
    if (typeof proposal.definition !== "string" || !proposal.definition.trim()) {
      throw new Error("proposal definition must be non-empty");
    }
    return {
      action: "propose",
      proposal: { name: proposal.name.trim(), definition: proposal.definition.trim() },
      ...details,
    };
  }
  throw new Error("action must be existing or propose");
}

function parseDetails(record: Record<string, unknown>): ClassificationDetails {
  if (typeof record.summary !== "string" || !record.summary.trim()) {
    throw new Error("summary must be a non-empty string");
  }
  if (
    !Array.isArray(record.tags) ||
    record.tags.some((tag) => typeof tag !== "string" || !tag.trim())
  ) {
    throw new Error("tags must be an array of non-empty strings");
  }
  for (const score of ["confidence_score", "fit_score"] as const) {
    if (
      typeof record[score] !== "number" ||
      !Number.isFinite(record[score]) ||
      record[score] < 0 ||
      record[score] > 1
    ) {
      throw new Error(`${score} must be between 0 and 1`);
    }
  }
  return {
    summary: record.summary.trim(),
    tags: [...new Set(record.tags.map((tag) => tag.trim()))],
    confidence_score: record.confidence_score as number,
    fit_score: record.fit_score as number,
  };
}
