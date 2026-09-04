import {
  categoryText,
  type CategoryProposal,
  type StoredCategory,
} from "./categories.ts";
import {
  cosineSimilarity,
  type EmbeddingProvider,
} from "./embeddings.ts";

export const DEFAULT_CATEGORY_DEDUP_THRESHOLD = 0.85;

export type CategoryResolution =
  | { action: "merge"; category: StoredCategory; similarity: number; embedding: number[] }
  | { action: "create"; similarity: number; embedding: number[] };

export async function resolveCategoryProposal(
  proposal: CategoryProposal,
  categories: StoredCategory[],
  provider: EmbeddingProvider,
  threshold = DEFAULT_CATEGORY_DEDUP_THRESHOLD,
): Promise<CategoryResolution> {
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
    throw new Error("dedup threshold must be between -1 and 1");
  }
  const embedding = await provider.embed(categoryText(proposal));
  let nearest: StoredCategory | null = null;
  let similarity = -1;
  for (const category of categories) {
    if (!category.embedding || category.embedding.length !== embedding.length) continue;
    const score = cosineSimilarity(embedding, category.embedding);
    if (score > similarity) {
      similarity = score;
      nearest = category;
    }
  }
  if (nearest && similarity > threshold) {
    return { action: "merge", category: nearest, similarity, embedding };
  }
  return { action: "create", similarity, embedding };
}
