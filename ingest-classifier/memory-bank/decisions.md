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
