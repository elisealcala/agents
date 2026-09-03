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
