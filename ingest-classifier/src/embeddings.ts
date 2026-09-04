import { createHash } from "node:crypto";

export type EmbeddingProvider = {
  id: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with",
]);

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

export class LocalHashEmbedding implements EmbeddingProvider {
  readonly id = "local-hash-v1";
  readonly dimensions: number;

  constructor(dimensions = 256) {
    if (!Number.isInteger(dimensions) || dimensions < 16) {
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
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}
