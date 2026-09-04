export { loadConfig, type ModelConfig, type Provider } from "./config.ts";
export { createModelClient } from "./providers/createClient.ts";
export type { ModelClient } from "./providers/types.ts";
export { AuditStore, type AuditRecord, type AuditStatus } from "./audit.ts";
export {
  buildClassificationPrompt,
  classifyFile,
  parseClassification,
  type Classification,
} from "./classifier.ts";
export { moveWithoutOverwrite, restoreMovedFile } from "./fileMover.ts";
export { markdownToText, parseMarkdownFile } from "./markdown.ts";
export { IngestPipeline, type ProcessResult } from "./pipeline.ts";
export {
  AdaptiveIngestPipeline,
  type AdaptiveProcessResult,
} from "./adaptivePipeline.ts";
export {
  buildAdaptiveClassificationPrompt,
  classifyWithLiveTaxonomy,
  parseAdaptiveClassification,
  EXISTING_CATEGORY_FIT_THRESHOLD,
  type AdaptiveClassification,
} from "./adaptiveClassifier.ts";
export { CategoryStore, type StoredCategory, type CategoryProposal } from "./categories.ts";
export {
  DEFAULT_CATEGORY_DEDUP_THRESHOLD,
  resolveCategoryProposal,
} from "./categoryDedup.ts";
export {
  LocalHashEmbedding,
  cosineSimilarity,
  type EmbeddingProvider,
} from "./embeddings.ts";
export {
  DocumentStore,
  backfillDocumentEmbeddings,
  type StoredDocument,
  type EmbeddingStatus,
  type BackfillReport,
} from "./documents.ts";
export {
  CorrectionStore,
  DEFAULT_CORRECTION_EXAMPLE_LIMIT,
  type Correction,
} from "./corrections.ts";
export {
  runClusteringJob,
  suggestTaxonomySplits,
  type ClusteringReport,
  type TaxonomySplitSuggestion,
} from "./clustering.ts";
export {
  answerQuestion,
  buildGroundedAnswerPrompt,
  retrieveDocuments,
  type GroundedAnswer,
  type RetrievalHit,
} from "./retrieval.ts";
export {
  LOW_CONFIDENCE_FALLBACK,
  LOW_CONFIDENCE_THRESHOLD,
  SEED_CATEGORIES,
  ensureLibraryLayout,
  getLibraryPaths,
} from "./taxonomy.ts";
