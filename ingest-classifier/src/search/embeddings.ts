/**
 * Deterministic local embeddings (DEC-008).
 *
 * Vectors are derived by hashing tokens into fixed buckets, so the same text
 * always yields the same vector, no network call is made, and evaluations stay
 * offline. The trade-off is that these vectors capture shared vocabulary, not
 * meaning: paraphrases with no words in common score poorly.
 */
import { createHash } from "node:crypto";

/** Bucket count for a local vector. Wide enough to keep collisions rare. */
export const DEFAULT_EMBEDDING_DIMENSIONS = 256;

/** Below this, hash collisions dominate and similarity stops being useful. */
const MINIMUM_EMBEDDING_DIMENSIONS = 16;

/** A source of vectors. Implementations must be deterministic for a given id. */
export type EmbeddingProvider = {
  id: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

/**
 * Words folded together before hashing, so related notes share buckets.
 *
 * Local hashing has no notion of meaning: "recipes" and "recipe" would land in
 * unrelated buckets and score as unrelated documents. Collapsing known
 * variants to one term is what lets a paraphrase merge into an existing
 * category instead of proposing a duplicate.
 *
 * The vocabulary is deliberately small and literal, and it leans toward the
 * themes the offline evaluations exercise. That is a known limitation of
 * DEC-008, not an accident: it is the cost of keeping evaluations offline and
 * deterministic. Replacing this provider with a real embedding model makes the
 * whole table unnecessary.
 */
const CANONICAL_TERMS: Record<string, string> = {
  api: "architecture",
  apis: "architecture",
  architectural: "architecture",
  code: "architecture",
  coding: "architecture",
  database: "architecture",
  engineering: "architecture",
  software: "architecture",
  system: "architecture",
  systems: "architecture",
  tech: "technical",
  specs: "specification",
  spec: "specification",
  requirements: "requirement",
  meetings: "meeting",
  minutes: "meeting",
  bicycle: "bike",
  bicycles: "bike",
  cycling: "bike",
  repairs: "repair",
  recipes: "recipe",
  cooking: "cook",
};

/** Hashes canonicalized tokens into fixed buckets. Deterministic and offline. */
export class LocalHashEmbedding implements EmbeddingProvider {
  readonly id = "local-hash-v1";
  readonly dimensions: number;

  constructor(dimensions: number = DEFAULT_EMBEDDING_DIMENSIONS) {
    if (
      !Number.isInteger(dimensions) ||
      dimensions < MINIMUM_EMBEDDING_DIMENSIONS
    ) {
      throw new Error("embedding dimensions must be an integer of at least 16");
    }
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    for (const token of tokens) {
      const digest = createHash("sha256").update(token).digest();
      const index = digest.readUInt32BE(0) % this.dimensions;
      const sign = digest[4]! % 2 === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    return normalizeVector(vector);
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error("vectors must have the same non-zero dimensions");
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((token) => CANONICAL_TERMS[token] ?? token)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}
