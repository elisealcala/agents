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
  LOW_CONFIDENCE_FALLBACK,
  LOW_CONFIDENCE_THRESHOLD,
  SEED_CATEGORIES,
  ensureLibraryLayout,
  getLibraryPaths,
} from "./taxonomy.ts";
