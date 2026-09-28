/**
 * Classification against the live taxonomy, which grows as notes arrive.
 *
 * The model is shown the whole current category tree and either files a note
 * under the most specific category that fits as a whole, or proposes exactly
 * one new child beneath the closest existing one (DEC-019).
 */
import type { ModelClient } from "../providers/types.ts";
import { DEFAULT_CLASSIFICATION_ATTEMPTS } from "../defaults.ts";
import type {
  StoredCategory,
  CategoryProposal,
} from "../storage/categories.ts";

/**
 * How well a live category must cover a note before it is filed there.
 *
 * This replaces the proposal half of DEC-007 for the adaptive path: a child
 * proposal may also score above it, because a parent can fit while still being
 * too broad. The fixed pipeline is unaffected and still uses confidence.
 */
export const EXISTING_CATEGORY_FIT_THRESHOLD = 0.8;

/**
 * The threshold as the prompt and the error messages spell it.
 *
 * Derived rather than retyped so the instruction the model receives can never
 * disagree with the check applied to its answer. `toFixed(2)` keeps the exact
 * "0.80" wording the prompt has always used.
 */
const FIT_THRESHOLD_TEXT = EXISTING_CATEGORY_FIT_THRESHOLD.toFixed(2);

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
  parent: string;
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
  const maxAttempts = options.maxAttempts ?? DEFAULT_CLASSIFICATION_ATTEMPTS;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.complete(
        buildAdaptiveClassificationPrompt(
          cleanText,
          categories,
          options.examples ?? [],
        ),
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
  const fewShot = examples.length
    ? `\nCorrections to learn from:\n${examples.map((example) => `- ${example}`).join("\n")}\n`
    : "";
  return `Classify one note into the most specific category in the live taxonomy.

Existing Categories:
${formatTaxonomy(categories)}

If the note is about an existing category as a whole, and that category is the most specific match, return:
{"action":"existing","category":"category_id","summary":"one or two sentences","tags":["tag"],"confidence_score":0.0,"fit_score":0.0}

If the note is a narrower subtopic, propose exactly one new child under the closest existing category:
{"action":"propose","parent":"parent_category_id","proposal":{"name":"Specific Category","definition":"One sentence defining the category."},"summary":"one or two sentences","tags":["tag"],"confidence_score":0.0,"fit_score":0.0}

An existing match requires fit_score > ${FIT_THRESHOLD_TEXT}. A child proposal may also have fit_score > ${FIT_THRESHOLD_TEXT} when the parent fits but is too broad. Return JSON only. Scores must be between 0 and 1.${fewShot}
Note:
${cleanText}`;
}

function formatTaxonomy(categories: StoredCategory[]): string {
  const byParent = new Map<string | null, StoredCategory[]>();
  for (const category of categories) {
    const group = byParent.get(category.parentId) ?? [];
    group.push(category);
    byParent.set(category.parentId, group);
  }
  const lines: string[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      lines.push(
        `${"  ".repeat(depth)}- ${category.id} (${category.name}): ${category.definition}`,
      );
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
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
    if (
      typeof record.category !== "string" ||
      !categories.some(({ id }) => id === record.category)
    ) {
      throw new Error("existing category must be a live category id");
    }
    if (details.fit_score <= EXISTING_CATEGORY_FIT_THRESHOLD) {
      throw new Error(
        `existing category fit_score must be greater than ${FIT_THRESHOLD_TEXT}`,
      );
    }
    return { action: "existing", category: record.category, ...details };
  }
  if (record.action === "propose") {
    if (
      typeof record.parent !== "string" ||
      !categories.some(({ id }) => id === record.parent)
    ) {
      throw new Error("proposal parent must be a live category id");
    }
    if (
      !record.proposal ||
      typeof record.proposal !== "object" ||
      Array.isArray(record.proposal)
    ) {
      throw new Error("proposal must contain a name and definition");
    }
    const proposal = record.proposal as Record<string, unknown>;
    if (typeof proposal.name !== "string" || !proposal.name.trim()) {
      throw new Error("proposal name must be non-empty");
    }
    if (
      typeof proposal.definition !== "string" ||
      !proposal.definition.trim()
    ) {
      throw new Error("proposal definition must be non-empty");
    }
    return {
      action: "propose",
      parent: record.parent,
      proposal: {
        name: proposal.name.trim(),
        definition: proposal.definition.trim(),
      },
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
