/**
 * Deterministic two-way clustering that looks for categories holding two
 * distinct themes.
 *
 * Every function here is advisory. Nothing moves a file, creates a folder or
 * edits the taxonomy — a human reads the report and decides (DEC-011).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentStore, StoredDocument } from "../storage/documents.ts";
import { cosineSimilarity } from "./embeddings.ts";

/** How many documents a category needs before a split is worth considering. */
export const DEFAULT_MINIMUM_CATEGORY_SIZE = 6;

/** Both sides must reach this size, so one outlier cannot force a split. */
export const DEFAULT_MINIMUM_CLUSTER_SIZE = 2;

/**
 * How far apart the two centroids must sit, as `1 - cosine similarity`.
 * Below this the two halves are near-identical and the split is noise.
 */
export const DEFAULT_MINIMUM_SEPARATION = 0.1;

/**
 * Above this similarity between the seed vectors, the category is treated as
 * too homogeneous to divide and clustering stops before it starts.
 */
const MAXIMUM_HOMOGENEOUS_SIMILARITY = 0.98;

/** Iteration cap. Assignments normally settle in far fewer passes. */
const MAX_KMEANS_ITERATIONS = 25;

/** Tokens shorter than this carry no thematic signal. */
const MINIMUM_LABEL_TOKEN_LENGTH = 2;

/** How many frequent tokens name a cluster, joined with " / ". */
const LABEL_TOKEN_COUNT = 3;

/** How many filenames are shown as examples of a cluster. */
const EXAMPLE_FILE_COUNT = 3;

/** One side of a proposed split, named by its most frequent tokens. */
export type SuggestedCluster = {
  label: string;
  documentCount: number;
  exampleFiles: string[];
};

/** A category that appears to hold two themes, and how far apart they are. */
export type TaxonomySplitSuggestion = {
  action: "split";
  categoryId: string;
  reason: string;
  separation: number;
  clusters: [SuggestedCluster, SuggestedCluster];
};

/** One clustering pass over every category large enough to examine. */
export type ClusteringReport = {
  generatedAt: string;
  examinedCategories: number;
  suggestions: TaxonomySplitSuggestion[];
};

/** Thresholds controlling when a split is proposed. All have defaults. */
export type SplitDetectionOptions = {
  minimumCategorySize?: number;
  minimumClusterSize?: number;
  minimumSeparation?: number;
};

/** Find categories worth splitting. Returns suggestions only. */
export function suggestTaxonomySplits(
  documents: StoredDocument[],
  options: SplitDetectionOptions = {},
): TaxonomySplitSuggestion[] {
  const minimumCategorySize =
    options.minimumCategorySize ?? DEFAULT_MINIMUM_CATEGORY_SIZE;
  const minimumClusterSize =
    options.minimumClusterSize ?? DEFAULT_MINIMUM_CLUSTER_SIZE;
  const minimumSeparation =
    options.minimumSeparation ?? DEFAULT_MINIMUM_SEPARATION;
  const byCategory = new Map<string, StoredDocument[]>();
  for (const document of documents) {
    if (!document.embedding) continue;
    const group = byCategory.get(document.categoryId) ?? [];
    group.push(document);
    byCategory.set(document.categoryId, group);
  }

  const suggestions: TaxonomySplitSuggestion[] = [];
  for (const [categoryId, group] of byCategory) {
    if (group.length < minimumCategorySize) continue;
    const clusters = kMeansTwo(group);
    if (!clusters) continue;
    if (
      clusters.left.length < minimumClusterSize ||
      clusters.right.length < minimumClusterSize
    ) {
      continue;
    }
    const separation =
      1 - cosineSimilarity(clusters.leftCentroid, clusters.rightCentroid);
    if (separation < minimumSeparation) continue;
    const left = summarizeCluster(clusters.left);
    const right = summarizeCluster(clusters.right);
    suggestions.push({
      action: "split",
      categoryId,
      reason: `${group.length} documents form two meaningfully separated groups (${left.label} vs ${right.label}). Review examples before applying.`,
      separation,
      clusters: [left, right],
    });
  }
  return suggestions;
}

/** Inputs for one clustering pass. `outputPath` writes the report to disk. */
export type ClusteringJobOptions = {
  documents: DocumentStore;
  outputPath?: string;
  minimumCategorySize?: number;
};

/** Run one clustering pass. Never moves a file or edits the taxonomy. */
export async function runClusteringJob(
  options: ClusteringJobOptions,
): Promise<ClusteringReport> {
  const ready = options.documents.list("ready");
  const report: ClusteringReport = {
    generatedAt: new Date().toISOString(),
    examinedCategories: new Set(ready.map(({ categoryId }) => categoryId)).size,
    suggestions: suggestTaxonomySplits(ready, {
      minimumCategorySize: options.minimumCategorySize,
    }),
  };
  if (options.outputPath) {
    await writeFile(
      options.outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  }
  return report;
}

function kMeansTwo(documents: StoredDocument[]): {
  left: StoredDocument[];
  right: StoredDocument[];
  leftCentroid: number[];
  rightCentroid: number[];
} | null {
  const vectors = documents.map(({ embedding }) => embedding!);
  let leftCentroid = [...vectors[0]!];
  let rightIndex = 1;
  let smallestSimilarity = 1;
  for (let index = 1; index < vectors.length; index += 1) {
    const similarity = cosineSimilarity(leftCentroid, vectors[index]!);
    if (similarity < smallestSimilarity) {
      smallestSimilarity = similarity;
      rightIndex = index;
    }
  }
  if (smallestSimilarity > MAXIMUM_HOMOGENEOUS_SIMILARITY) return null;
  let rightCentroid = [...vectors[rightIndex]!];
  let assignments = new Array<number>(documents.length).fill(-1);

  for (let iteration = 0; iteration < MAX_KMEANS_ITERATIONS; iteration += 1) {
    const next = vectors.map((vector) =>
      cosineSimilarity(vector, leftCentroid) >=
      cosineSimilarity(vector, rightCentroid)
        ? 0
        : 1,
    );
    if (next.every((value, index) => value === assignments[index])) break;
    assignments = next;
    const leftVectors = vectors.filter(
      (_vector, index) => assignments[index] === 0,
    );
    const rightVectors = vectors.filter(
      (_vector, index) => assignments[index] === 1,
    );
    if (!leftVectors.length || !rightVectors.length) return null;
    leftCentroid = centroid(leftVectors);
    rightCentroid = centroid(rightVectors);
  }

  return {
    left: documents.filter((_document, index) => assignments[index] === 0),
    right: documents.filter((_document, index) => assignments[index] === 1),
    leftCentroid,
    rightCentroid,
  };
}

function centroid(vectors: number[][]): number[] {
  const result = new Array<number>(vectors[0]!.length).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < result.length; index += 1) {
      result[index] = (result[index] ?? 0) + (vector[index] ?? 0);
    }
  }
  const magnitude = Math.sqrt(
    result.reduce((sum, value) => sum + value * value, 0),
  );
  return magnitude === 0 ? result : result.map((value) => value / magnitude);
}

const LABEL_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "architecture",
  "code",
  "document",
  "for",
  "from",
  "into",
  "note",
  "notes",
  "that",
  "the",
  "this",
  "with",
]);

function summarizeCluster(documents: StoredDocument[]): SuggestedCluster {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const unique = new Set(
      (document.cleanText.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (token) =>
          token.length > MINIMUM_LABEL_TOKEN_LENGTH &&
          !LABEL_STOP_WORDS.has(token),
      ),
    );
    for (const token of unique) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  // Most frequent first, then alphabetically so the label is deterministic.
  const rankedTokens = [...counts].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const labelTokens = rankedTokens
    .slice(0, LABEL_TOKEN_COUNT)
    .map(([token]) => token);
  const label = labelTokens.join(" / ") || "untitled group";
  const exampleFiles = documents
    .slice(0, EXAMPLE_FILE_COUNT)
    .map(({ destinationPath }) => path.basename(destinationPath));
  return { label, documentCount: documents.length, exampleFiles };
}
