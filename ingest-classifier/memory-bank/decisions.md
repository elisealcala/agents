# Decisions — ingest-classifier

## DEC-001: TypeScript modular package

Date: 2026-09-02
Status: accepted
Context: This collection does not impose a stack. ingest-classifier needs a runtime before any classification work.
Decision: TypeScript (pnpm, tsx, vitest), modular `src/` — not LangGraph and not Python for this agent.
Consequences: Later slices (classify file/records) stay in this package and call `ModelClient`.

## DEC-002: OpenAI, Anthropic, and xAI via env

Date: 2026-09-02
Status: accepted
Context: First slice must be able to pick GPT, Claude, or a third model. Cursor SDK is not this slice; the third provider is the xAI API.
Decision: `INGEST_PROVIDER` (`openai` \| `anthropic` \| `xai`) + `INGEST_MODEL`. Keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`. No defaults — an explicit pick is required. xAI uses the OpenAI SDK with `baseURL: https://api.x.ai/v1`.
Consequences: Classification later calls `ModelClient.complete` (or structured output) so swapping vendors is an env change.

## DEC-003: Three-phase GitHub roadmap

Date: 2026-09-03
Status: accepted
Context: Product shape is a Markdown inbox organizer: classify, file, then grow taxonomy, then retrieve. Work needs Linear-like tickets on GitHub (this repo has no Linear).
Decision: Track delivery as three GitHub milestones (M1 zero-loss pipeline, M2 dynamic taxonomy, M3 re-cluster + RAG) with one epic + child issues per milestone. Implementation stays TypeScript (`DEC-001`); Python names in the brief (watchdog, etc.) are examples only.
Consequences: Next code slice is M1 (#2–#8), still on `ModelClient`. Do not start M2/M3 until M1 exit gate (#8). GitHub Projects Roadmap view is optional and needs a `project` token scope.

## DEC-004: M1 low-confidence fallback

Date: 2026-09-04
Status: accepted
Context: M1 cannot invent categories, but ambiguous notes must not disappear or remain silently unprocessed.
Decision: Classifications below 0.50 confidence are filed under the seed `reference_material` category while preserving the originally requested category in the result. Invalid schema responses are retried once, then audited as failed and left untouched in the inbox.
Consequences: Every schema-valid M1 classification has a deterministic destination; malformed or unreadable input fails closed with an audit trail.

## DEC-005: Collision-safe file creation before source removal

Date: 2026-09-04
Status: accepted
Context: POSIX rename may overwrite a destination, and copy-then-delete can lose data if verification is skipped.
Decision: Create the destination exclusively (hard link on the same volume, exclusive copy across volumes), verify its SHA-256, and only then unlink the source. Collisions receive `-2`, `-3`, and subsequent suffixes.
Consequences: Existing files are never overwritten and a failed destination write leaves the inbox source intact.

## DEC-006: Recommended M1 classification model

Date: 2026-09-04
Status: accepted
Context: M1 calls for a fast, cost-efficient classifier while preserving the existing multi-provider picker.
Decision: Recommend `openai` / `gpt-4o-mini` for M1, but keep `INGEST_PROVIDER` and `INGEST_MODEL` mandatory and explicit so Anthropic or xAI remains an environment-only swap.
Consequences: Production has no hidden provider/model default; offline evals and tests use fixture clients without live network calls.
