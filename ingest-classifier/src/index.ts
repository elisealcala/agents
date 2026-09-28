/**
 * The package's public surface, grouped by the concerns in the README's
 * architecture map.
 *
 * Importing this module has no side effects: nothing opens a database, reads
 * the environment or contacts a provider until you call something.
 *
 * Most integrators need only the **Application** group — `createIngestAgent`
 * plus the contracts — which is what both the CLI and the MCP server use. The
 * lower-level groups are exported so a different runtime can assemble the
 * pipeline itself.
 */

// ---------------------------------------------------------------------------
// Application — the supported entry point for supervisors (DEC-016, DEC-017)
// ---------------------------------------------------------------------------
export {
  createIngestAgent,
  IngestAgent,
  type IngestAgentOptions,
} from "./application/agent.ts";
export {
  type OperationResult,
  type OperationError,
  type IngestReport,
  type IngestCounts,
  type ReportedProcessResult,
  type ReportedClassification,
  type CategoryRecord,
  type QuestionInput,
  type CorrectionInput,
  type ClusterInput,
  type SearchReport,
  type AnswerReport,
  type CorrectionRecord,
  type ClusteringReport as ClusteringReportContract,
  type EmbeddingBackfillReport,
  type SourceExcerpt,
  OperationFailure,
  resultSchema,
  ingestReportSchema,
  searchReportSchema,
  answerSchema,
  correctionSchema,
  clusteringReportSchema,
  backfillReportSchema,
  emptyInputSchema,
  questionInputSchema,
  correctionInputSchema,
  clusterInputSchema,
} from "./application/contracts.ts";
export { createClassifierServer } from "./mcp/server.ts";

// ---------------------------------------------------------------------------
// Shared defaults — values the fixed and adaptive paths must agree on
// ---------------------------------------------------------------------------
export {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_CLASSIFICATION_ATTEMPTS,
} from "./defaults.ts";

// ---------------------------------------------------------------------------
// Orchestration — scanning an inbox and driving one file through the steps
// ---------------------------------------------------------------------------
export {
  AdaptiveIngestPipeline,
  type AdaptiveProcessResult,
} from "./pipelines/adaptive-pipeline.ts";
export { IngestPipeline, type ProcessResult } from "./pipelines/pipeline.ts";

// ---------------------------------------------------------------------------
// Classification — prompt construction and response validation
// ---------------------------------------------------------------------------
export {
  buildAdaptiveClassificationPrompt,
  classifyWithLiveTaxonomy,
  parseAdaptiveClassification,
  EXISTING_CATEGORY_FIT_THRESHOLD,
  type AdaptiveClassification,
} from "./classification/adaptive-classifier.ts";
export {
  buildClassificationPrompt,
  classifyFile,
  parseClassification,
  type Classification,
} from "./classification/classifier.ts";

// ---------------------------------------------------------------------------
// Taxonomy — the seed categories and deciding when a proposal already exists
// ---------------------------------------------------------------------------
export {
  LOW_CONFIDENCE_FALLBACK,
  LOW_CONFIDENCE_THRESHOLD,
  SEED_CATEGORIES,
  ensureLibraryLayout,
  getLibraryPaths,
  type SeedCategory,
  type SeedCategoryId,
  type LibraryPaths,
} from "./taxonomy/taxonomy.ts";
export {
  DEFAULT_CATEGORY_DEDUP_THRESHOLD,
  resolveCategoryProposal,
  type CategoryResolution,
} from "./taxonomy/category-dedup.ts";

// ---------------------------------------------------------------------------
// Files — reading notes and moving them without ever overwriting one
// ---------------------------------------------------------------------------
export {
  moveWithoutOverwrite,
  restoreMovedFile,
  type MoveResult,
} from "./files/file-mover.ts";
export {
  markdownToText,
  parseMarkdownFile,
  type ParsedMarkdown,
} from "./files/markdown.ts";

// ---------------------------------------------------------------------------
// Storage — the SQLite memory the running classifier keeps
// ---------------------------------------------------------------------------
export {
  AuditStore,
  isCompletedAuditRecord,
  type AuditRecord,
  type CompletedAuditRecord,
  type AuditStatus,
  type AuditStage,
} from "./storage/audit.ts";
export {
  CategoryStore,
  type StoredCategory,
  type CategoryProposal,
} from "./storage/categories.ts";
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

// ---------------------------------------------------------------------------
// Search — embeddings, grounded retrieval, and suggestion-only clustering
// ---------------------------------------------------------------------------
export {
  LocalHashEmbedding,
  cosineSimilarity,
  DEFAULT_EMBEDDING_DIMENSIONS,
  type EmbeddingProvider,
} from "./search/embeddings.ts";
export {
  answerQuestion,
  buildGroundedAnswerPrompt,
  retrieveDocuments,
  DEFAULT_TOP_K,
  DEFAULT_MINIMUM_SCORE,
  type GroundedAnswer,
  type RetrievalHit,
} from "./search/retrieval.ts";
export {
  runClusteringJob,
  suggestTaxonomySplits,
  DEFAULT_MINIMUM_CATEGORY_SIZE,
  DEFAULT_MINIMUM_CLUSTER_SIZE,
  DEFAULT_MINIMUM_SEPARATION,
  type ClusteringReport,
  type TaxonomySplitSuggestion,
  type SuggestedCluster,
} from "./search/clustering.ts";

// ---------------------------------------------------------------------------
// Model providers — configuration and the one interface each adapter implements
// ---------------------------------------------------------------------------
export { loadConfig, type ModelConfig, type Provider } from "./config.ts";
export { createModelClient } from "./providers/create-client.ts";
export type { ModelClient } from "./providers/types.ts";
