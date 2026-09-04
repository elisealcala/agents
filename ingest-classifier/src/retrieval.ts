import type { DocumentStore, StoredDocument } from "./documents.ts";
import { cosineSimilarity, type EmbeddingProvider } from "./embeddings.ts";
import type { ModelClient } from "./providers/types.ts";

export type RetrievalHit = {
  document: StoredDocument;
  score: number;
  snippet: string;
};

export type GroundedAnswer = {
  answer: string;
  sources: Array<{ path: string; score: number; snippet: string }>;
};

export async function retrieveDocuments(options: {
  question: string;
  documents: DocumentStore;
  embeddingProvider: EmbeddingProvider;
  topK?: number;
  minimumScore?: number;
}): Promise<RetrievalHit[]> {
  const question = options.question.trim();
  if (!question) return [];
  const topK = options.topK ?? 5;
  const minimumScore = options.minimumScore ?? 0.2;
  if (!Number.isInteger(topK) || topK < 1) throw new Error("topK must be a positive integer");
  if (!Number.isFinite(minimumScore) || minimumScore < -1 || minimumScore > 1) {
    throw new Error("minimumScore must be between -1 and 1");
  }
  const queryEmbedding = await options.embeddingProvider.embed(question);
  return options.documents
    .list("ready")
    .flatMap((document) => {
      if (!document.embedding || document.embedding.length !== queryEmbedding.length) return [];
      const score = cosineSimilarity(queryEmbedding, document.embedding);
      return score >= minimumScore
        ? [{ document, score, snippet: createSnippet(document.cleanText) }]
        : [];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

export async function answerQuestion(options: {
  question: string;
  documents: DocumentStore;
  embeddingProvider: EmbeddingProvider;
  model?: ModelClient;
  topK?: number;
  minimumScore?: number;
}): Promise<GroundedAnswer> {
  const question = options.question.trim();
  if (!question) {
    return { answer: "Please provide a non-empty question.", sources: [] };
  }
  const hits = await retrieveDocuments(options);
  if (!hits.length) {
    return {
      answer: "I couldn't find a sufficiently relevant source in the organized library.",
      sources: [],
    };
  }
  const sources = hits.map(({ document, score, snippet }) => ({
    path: document.destinationPath,
    score,
    snippet,
  }));
  const answerBody = options.model
    ? await options.model.complete(buildGroundedAnswerPrompt(question, hits))
    : hits.map(({ document, snippet }) => `${snippet} [${document.destinationPath}]`).join("\n\n");
  const citations = sources.map(({ path }) => `- ${path}`).join("\n");
  return {
    answer: `${answerBody.trim()}\n\nSources:\n${citations}`,
    sources,
  };
}

export function buildGroundedAnswerPrompt(
  question: string,
  hits: RetrievalHit[],
): string {
  const context = hits
    .map(
      ({ document, snippet }, index) =>
        `[${index + 1}] Path: ${document.destinationPath}\nSummary: ${document.summary}\nExcerpt: ${snippet}`,
    )
    .join("\n\n");
  return `Answer the question using only the grounded excerpts below.
If the excerpts do not contain the answer, say that clearly. Do not name or cite any path not shown below.

Question: ${question}

Grounded excerpts:
${context}`;
}

function createSnippet(cleanText: string, maximumLength = 320): string {
  const compact = cleanText.replace(/\s+/g, " ").trim();
  return compact.length <= maximumLength
    ? compact
    : `${compact.slice(0, maximumLength - 1).trimEnd()}…`;
}
