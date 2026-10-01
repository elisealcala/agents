/**
 * Classification against the live taxonomy, which grows as notes arrive.
 *
 * The model looks the taxonomy up and either files a note under the most
 * specific category that fits as a whole, or proposes exactly one new child
 * beneath the closest existing one (DEC-019, DEC-025). The pipeline, not the
 * model, creates the category and moves the file.
 */
import type { ModelClient } from "../providers/types.ts";
import { DEFAULT_CLASSIFICATION_ATTEMPTS } from "../defaults.ts";
import type {
  StoredCategory,
  CategoryProposal,
} from "../storage/categories.ts";
import type { AgentHooks } from "../agent/hooks.ts";
import {
  buildOrganizerSystemPrompt,
  placeNote,
  toolRecord,
  type RecentFiling,
  type SimilarNote,
} from "./organizer.ts";
import type { ToolLoopObserver } from "../providers/types.ts";

/**
 * How well a live category must cover a note before it is filed there.
 *
 * This replaces the proposal half of DEC-007 for the adaptive path: a child
 * proposal may also score above it, because a parent can fit while still being
 * too broad. The fixed pipeline is unaffected and still uses confidence.
 */
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
  options: {
    maxAttempts?: number;
    examples?: string[];
    searchSimilar?: () => Promise<SimilarNote[]>;
    listRecent?: () => Promise<RecentFiling[]> | RecentFiling[];
    fitThreshold?: number;
    promptTemplate?: string;
    observe?: ToolLoopObserver;
  } = {},
): Promise<AdaptiveClassification> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_CLASSIFICATION_ATTEMPTS;
  const examples = options.examples ?? [];
  const fitThreshold = options.fitThreshold ?? EXISTING_CATEGORY_FIT_THRESHOLD;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await placeNote(client, {
        system: buildAdaptiveClassificationPrompt(examples, {
          fitThreshold,
          promptTemplate: options.promptTemplate,
        }),
        user: cleanText,
        entries: categories.map((category) => ({
          id: category.id,
          name: category.name,
          definition: category.definition,
          parentId: category.parentId,
        })),
        allowPropose: true,
        searchSimilar: options.searchSimilar ?? (async () => []),
        listRecent: options.listRecent,
        acceptExisting: (input) =>
          acceptExisting(input, categories, fitThreshold),
        acceptPropose: (input) =>
          acceptProposal(input, categories, fitThreshold),
        observe: options.observe,
        hooks: adaptivePlacementHooks(categories, fitThreshold),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(
    `adaptive classification failed after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

/** System prompt for the adaptive organizer. The note is the user message. */
export function buildAdaptiveClassificationPrompt(
  examples: string[] = [],
  options: { fitThreshold?: number; promptTemplate?: string } = {},
): string {
  const fitThreshold = options.fitThreshold ?? EXISTING_CATEGORY_FIT_THRESHOLD;
  return buildOrganizerSystemPrompt({
    allowPropose: true,
    fitThresholdText: fitThreshold.toFixed(2),
    examples,
    promptTemplate: options.promptTemplate,
  });
}

/**
 * PreToolUse hook that runs the adaptive classifier.
 *
 * The matcher is `file_existing|propose_child`. A placement that fails the
 * live-taxonomy rules is denied before the tool handler records it. An empty
 * return allows the handler to record the same placement.
 */
export function adaptivePlacementHooks(
  categories: StoredCategory[],
  fitThreshold: number,
): AgentHooks {
  return {
    PreToolUse: [
      {
        matcher: "file_existing|propose_child",
        hooks: [
          async (input) => {
            try {
              if (input.tool_name === "file_existing") {
                acceptExisting(input.tool_input, categories, fitThreshold);
              } else if (input.tool_name === "propose_child") {
                acceptProposal(input.tool_input, categories, fitThreshold);
              }
              return {};
            } catch (error) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason:
                    error instanceof Error ? error.message : String(error),
                },
              };
            }
          },
        ],
      },
    ],
  };
}

function acceptExisting(
  input: unknown,
  categories: StoredCategory[],
  fitThreshold: number,
): AdaptiveClassification {
  const record = toolRecord(input);
  return parseAdaptiveClassification(
    JSON.stringify({
      action: "existing",
      category: record.category,
      summary: record.summary,
      tags: record.tags,
      confidence_score: record.confidence_score,
      fit_score: record.fit_score,
    }),
    categories,
    fitThreshold,
  );
}

function acceptProposal(
  input: unknown,
  categories: StoredCategory[],
  fitThreshold: number,
): AdaptiveClassification {
  const record = toolRecord(input);
  return parseAdaptiveClassification(
    JSON.stringify({
      action: "propose",
      parent: record.parent,
      proposal: { name: record.name, definition: record.definition },
      summary: record.summary,
      tags: record.tags,
      confidence_score: record.confidence_score,
      fit_score: record.fit_score,
    }),
    categories,
    fitThreshold,
  );
}

export function parseAdaptiveClassification(
  raw: string,
  categories: StoredCategory[],
  fitThreshold: number = EXISTING_CATEGORY_FIT_THRESHOLD,
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
    if (details.fit_score <= fitThreshold) {
      throw new Error(
        `existing category fit_score must be greater than ${fitThreshold.toFixed(2)}`,
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
