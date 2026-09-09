export { loadConfig, type ModelConfig, type Provider } from "./config.ts";
export { createModelClient } from "./providers/createClient.ts";
export type { ModelClient } from "./providers/types.ts";
export {
  AuditStore,
  type AuditRecord,
  type AuditStatus,
} from "./storage/audit.ts";
export {
  buildClassificationPrompt,
  classifyFile,
  parseClassification,
  type Classification,
} from "./classification/classifier.ts";
export { moveWithoutOverwrite, restoreMovedFile } from "./files/fileMover.ts";
export { markdownToText, parseMarkdownFile } from "./files/markdown.ts";
export { IngestPipeline, type ProcessResult } from "./pipelines/pipeline.ts";
export {
  AdaptiveIngestPipeline,
  type AdaptiveProcessResult,
} from "./pipelines/adaptivePipeline.ts";
export {
  buildAdaptiveClassificationPrompt,
  classifyWithLiveTaxonomy,
  parseAdaptiveClassification,
  EXISTING_CATEGORY_FIT_THRESHOLD,
  type AdaptiveClassification,
} from "./classification/adaptiveClassifier.ts";
export {
  CategoryStore,
  type StoredCategory,
  type CategoryProposal,
} from "./storage/categories.ts";
export {
  DEFAULT_CATEGORY_DEDUP_THRESHOLD,
  resolveCategoryProposal,
} from "./taxonomy/categoryDedup.ts";
export {
  LocalHashEmbedding,
  cosineSimilarity,
  type EmbeddingProvider,
} from "./search/embeddings.ts";
export {
  DocumentStore,
  backfillDocumentEmbeddings,
  type StoredDocument,
  type EmbeddingStatus,
  type BackfillReport,
} from "./storage/documents.ts";
export {
  CorrectionStore,
  DEFAULT_CORRECTION_EXAMPLE_LIMIT,
  type Correction,
} from "./storage/corrections.ts";
export {
  runClusteringJob,
  suggestTaxonomySplits,
  type ClusteringReport,
  type TaxonomySplitSuggestion,
} from "./search/clustering.ts";
export {
  answerQuestion,
  buildGroundedAnswerPrompt,
  retrieveDocuments,
  type GroundedAnswer,
  type RetrievalHit,
} from "./search/retrieval.ts";
export {
  LOW_CONFIDENCE_FALLBACK,
  LOW_CONFIDENCE_THRESHOLD,
  SEED_CATEGORIES,
  ensureLibraryLayout,
  getLibraryPaths,
} from "./taxonomy/taxonomy.ts";
