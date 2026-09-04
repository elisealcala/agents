import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentStore, StoredDocument } from "./documents.ts";
import { cosineSimilarity } from "./embeddings.ts";

export type SuggestedCluster = {
  label: string;
  documentCount: number;
  exampleFiles: string[];
};

export type TaxonomySplitSuggestion = {
  action: "split";
  categoryId: string;
  reason: string;
  separation: number;
  clusters: [SuggestedCluster, SuggestedCluster];
};

export type ClusteringReport = {
  generatedAt: string;
  examinedCategories: number;
  suggestions: TaxonomySplitSuggestion[];
};

export function suggestTaxonomySplits(
  documents: StoredDocument[],
  options: { minimumCategorySize?: number; minimumClusterSize?: number; minimumSeparation?: number } = {},
): TaxonomySplitSuggestion[] {
  const minimumCategorySize = options.minimumCategorySize ?? 6;
  const minimumClusterSize = options.minimumClusterSize ?? 2;
  const minimumSeparation = options.minimumSeparation ?? 0.1;
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
    if (clusters.left.length < minimumClusterSize || clusters.right.length < minimumClusterSize) {
      continue;
    }
    const separation = 1 - cosineSimilarity(clusters.leftCentroid, clusters.rightCentroid);
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

export async function runClusteringJob(options: {
  documents: DocumentStore;
  outputPath?: string;
  minimumCategorySize?: number;
}): Promise<ClusteringReport> {
  const ready = options.documents.list("ready");
  const report: ClusteringReport = {
    generatedAt: new Date().toISOString(),
    examinedCategories: new Set(ready.map(({ categoryId }) => categoryId)).size,
    suggestions: suggestTaxonomySplits(ready, {
      minimumCategorySize: options.minimumCategorySize,
    }),
  };
  if (options.outputPath) {
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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
  if (smallestSimilarity > 0.98) return null;
  let rightCentroid = [...vectors[rightIndex]!];
  let assignments = new Array<number>(documents.length).fill(-1);

  for (let iteration = 0; iteration < 25; iteration += 1) {
    const next = vectors.map((vector) =>
      cosineSimilarity(vector, leftCentroid) >= cosineSimilarity(vector, rightCentroid) ? 0 : 1,
    );
    if (next.every((value, index) => value === assignments[index])) break;
    assignments = next;
    const leftVectors = vectors.filter((_vector, index) => assignments[index] === 0);
    const rightVectors = vectors.filter((_vector, index) => assignments[index] === 1);
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
  const magnitude = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? result : result.map((value) => value / magnitude);
}

const LABEL_STOP_WORDS = new Set([
  "about", "after", "also", "and", "architecture", "code", "document", "for",
  "from", "into", "note", "notes", "that", "the", "this", "with",
]);

function summarizeCluster(documents: StoredDocument[]): SuggestedCluster {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const unique = new Set(
      (document.cleanText.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (token) => token.length > 2 && !LABEL_STOP_WORDS.has(token),
      ),
    );
    for (const token of unique) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const label = [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([token]) => token)
    .join(" / ") || "untitled group";
  return {
    label,
    documentCount: documents.length,
    exampleFiles: documents.slice(0, 3).map(({ destinationPath }) => path.basename(destinationPath)),
  };
}
