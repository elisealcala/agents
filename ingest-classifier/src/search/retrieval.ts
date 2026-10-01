/**
 * Grounded retrieval and question answering over stored vectors (DEC-012).
 *
 * Answers are built only from documents that clear the relevance floor, so an
 * unanswerable question returns an explicit no-sources reply rather than a
 * confident answer assembled from unrelated notes. Retrieval itself makes no
 * model call; only {@link answerQuestion} does.
 */
import type { DocumentStore, StoredDocument } from "../storage/documents.ts";
import { cosineSimilarity, type EmbeddingProvider } from "./embeddings.ts";
import type { CompletionInput, ModelClient } from "../providers/types.ts";
import type { TraceObserver } from "../observability/trace.ts";

/** How many excerpts a question retrieves before the model sees them. */
export const DEFAULT_TOP_K = 5;

/**
 * The relevance floor (DEC-012).
 *
 * A document scoring below this is not cited at all, so an unanswerable
 * question returns an explicit no-sources answer instead of a confident one
 * built from unrelated notes.
 */
export const DEFAULT_MINIMUM_SCORE = 0.2;

/** How much of a document's clean text is quoted back as a snippet. */
const DEFAULT_SNIPPET_LENGTH = 320;

/** One matching document, its similarity score and a quoted excerpt. */
export type RetrievalHit = {
  document: StoredDocument;
  score: number;
  snippet: string;
};

/** An answer and the excerpts it cites. Empty sources means none qualified. */
export type GroundedAnswer = {
  answer: string;
  sources: Array<{ path: string; score: number; snippet: string }>;
};

/** What a retrieval needs: a question, stored documents, and a vector source. */
export type RetrievalOptions = {
  question: string;
  documents: DocumentStore;
  embeddingProvider: EmbeddingProvider;
  topK?: number;
  minimumScore?: number;
};

/** Rank stored vectors against a question. No model call. */
export async function retrieveDocuments(
  options: RetrievalOptions,
): Promise<RetrievalHit[]> {
  const question = options.question.trim();
  if (!question) return [];
  const topK = options.topK ?? DEFAULT_TOP_K;
  const minimumScore = options.minimumScore ?? DEFAULT_MINIMUM_SCORE;
  if (!Number.isInteger(topK) || topK < 1)
    throw new Error("topK must be a positive integer");
  if (!Number.isFinite(minimumScore) || minimumScore < -1 || minimumScore > 1) {
    throw new Error("minimumScore must be between -1 and 1");
  }
  const queryEmbedding = await options.embeddingProvider.embed(question);
  return options.documents
    .list("ready")
    .flatMap((document) => {
      if (
        !document.embedding ||
        document.embedding.length !== queryEmbedding.length
      )
        return [];
      const score = cosineSimilarity(queryEmbedding, document.embedding);
      return score >= minimumScore
        ? [{ document, score, snippet: createSnippet(document.cleanText) }]
        : [];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

/** A retrieval plus the model that turns the excerpts into an answer. */
export type AnswerOptions = RetrievalOptions & {
  model?: ModelClient;
  trace?: { observer: TraceObserver; parentId: string | null };
};

/** Answer from retrieved excerpts, citing them. Needs a model client. */
export async function answerQuestion(
  options: AnswerOptions,
): Promise<GroundedAnswer> {
  const question = options.question.trim();
  if (!question) {
    return { answer: "Please provide a non-empty question.", sources: [] };
  }
  const hits = await retrieveForAnswer(options);
  if (!hits.length) {
    return {
      answer:
        "I couldn't find a sufficiently relevant source in the organized library.",
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
    : hits
        .map(
          ({ document, snippet }) => `${snippet} [${document.destinationPath}]`,
        )
        .join("\n\n");
  const citations = sources.map(({ path }) => `- ${path}`).join("\n");
  return {
    answer: `${answerBody.trim()}\n\nSources:\n${citations}`,
    sources,
  };
}

/** System prompt and user message that pin the answer to the retrieved excerpts. */
export function buildGroundedAnswerPrompt(
  question: string,
  hits: RetrievalHit[],
): CompletionInput {
  const context = hits
    .map(
      ({ document, snippet }, index) =>
        `[${index + 1}] Path: ${document.destinationPath}\nSummary: ${document.summary}\nExcerpt: ${snippet}`,
    )
    .join("\n\n");
  return {
    system: `Answer the question using only the grounded excerpts in the user message.
If the excerpts do not contain the answer, say that clearly. Do not name or cite any path not shown below.`,
    user: `Question: ${question}\n\nGrounded excerpts:\n${context}`,
  };
}

/** Rank documents, recording a tool span when a studio trace is attached. */
async function retrieveForAnswer(
  options: AnswerOptions,
): Promise<RetrievalHit[]> {
  if (!options.trace) return retrieveDocuments(options);
  const id = options.trace.observer.start({
    parentId: options.trace.parentId,
    name: "retrieve",
    kind: "tool",
    input: {
      question: options.question,
      topK: options.topK,
      minimumScore: options.minimumScore,
    },
  });
  try {
    const hits = await retrieveDocuments(options);
    options.trace.observer.end(id, {
      status: "ok",
      output: hits.map(({ document, score, snippet }) => ({
        path: document.destinationPath,
        score,
        snippet,
      })),
    });
    return hits;
  } catch (error) {
    options.trace.observer.end(id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Quote the opening of a document, trimmed to a whole word. */
function createSnippet(
  cleanText: string,
  maximumLength: number = DEFAULT_SNIPPET_LENGTH,
): string {
  const compact = cleanText.replace(/\s+/g, " ").trim();
  return compact.length <= maximumLength
    ? compact
    : `${compact.slice(0, maximumLength - 1).trimEnd()}…`;
}
