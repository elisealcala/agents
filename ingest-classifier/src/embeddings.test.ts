import { describe, expect, it } from "vitest";
import { LocalHashEmbedding, cosineSimilarity } from "./embeddings.ts";

function magnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

describe("LocalHashEmbedding", () => {
  it("creates deterministic normalized vectors locally", async () => {
    const provider = new LocalHashEmbedding(64);

    const first = await provider.embed("API architecture and database design");
    const repeated = await provider.embed("API architecture and database design");
    const normalizedText = await provider.embed("api, ARCHITECTURE & database design!");

    expect(provider.id).toBe("local-hash-v1");
    expect(provider.dimensions).toBe(64);
    expect(first).toHaveLength(64);
    expect(first).toEqual(repeated);
    expect(first).toEqual(normalizedText);
    expect(magnitude(first)).toBeCloseTo(1, 12);
  });

  it("normalizes known synonyms into the same semantic features", async () => {
    const provider = new LocalHashEmbedding(64);

    const synonyms = await provider.embed("API code database system");
    const canonical = await provider.embed(
      "architecture architecture architecture architecture",
    );

    expect(synonyms).toEqual(canonical);
    expect(cosineSimilarity(synonyms, canonical)).toBeCloseTo(1, 12);
  });

  it("returns a zero vector when no meaningful tokens remain", async () => {
    const provider = new LocalHashEmbedding(16);

    const vector = await provider.embed("a and the, or it");

    expect(vector).toEqual(new Array<number>(16).fill(0));
    expect(magnitude(vector)).toBe(0);
  });

  it.each([0, 15, 16.5, Number.NaN])(
    "rejects an invalid dimension count of %s",
    (dimensions) => {
      expect(() => new LocalHashEmbedding(dimensions)).toThrow(
        /integer of at least 16/,
      );
    },
  );
});

describe("cosineSimilarity", () => {
  it("handles identical, orthogonal, opposite, and zero vectors", () => {
    expect(cosineSimilarity([1, 2], [1, 2])).toBeCloseTo(1, 12);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([0, 0], [3, 4])).toBe(0);
  });

  it("is symmetric for non-normalized vectors", () => {
    expect(cosineSimilarity([3, 4], [4, 3])).toBeCloseTo(
      cosineSimilarity([4, 3], [3, 4]),
      12,
    );
  });

  it.each<[number[], number[]]>([
    [[], []],
    [[1], [1, 2]],
  ])("rejects incompatible vectors %j and %j", (left, right) => {
    expect(() => cosineSimilarity(left, right)).toThrow(
      /same non-zero dimensions/,
    );
  });
});
