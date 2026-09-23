# Active context — ingest-classifier

## Current focus

System-message clarification (2026-09-18): the worker does not manage conversational model turns or translate system messages between providers. Each call sends instructions and input together in a single user message; retries do not carry message history. Supporting separate system instructions/history would require extending ModelClient and the adapters.

Latest lookup (2026-09-18): provider selection is in `src/providers/createClient.ts:23`; OpenAI and Anthropic request/response shapes are handled by their individual adapters. Both forward the same prompt string without provider-specific sanitization. Ingestion performs shared UTF-8 validation and Markdown cleanup (`src/files/markdown.ts`); classification validates and normalizes responses centrally. These steps do not provide sensitive-data redaction or prompt-injection sanitization. No runtime changes were requested.

The approved standalone CLI and local MCP worker interface is implemented and verified (DEC-016–DEC-018). Both entry points share validated application operations. MCP serves six tools for one configured library, with structured success/partial/error results. The user approved publishing this verified release to main. It includes the shared operations, local MCP server, standalone CLI compatibility, tests, evaluations, and documentation.

## Verified status — 2026-09-15

- Frozen installation on Node 22.22.0 / pnpm 10.9.0 passes.
- Types, ESLint and Biome pass; 198 tests across 24 files pass.
- All four canonical offline evaluations pass: M1 (20 sorted notes), M2 (57 sorted notes), M3 (12 embeddings and retrieval/corrections/clustering), and MCP (all six tools, partial failure and contention).
- Modern 2026-07-28 and legacy 2025-11-25 MCP negotiation, direct Node/pnpm startup, clean stdout, EOF/SIGTERM draining, lock release, and side-effect-free public imports are verified.
- Standalone run/ask/correct/cluster/backfill behavior and partial-batch exit semantics are covered with offline fixtures. No live model calls were made.

## Boundaries

- Watch holds the ingestion lock for its lifetime. After an abrupt termination, stale locks require manual removal after confirming no active ingestion remains.
- The lock coordinates application/CLI/MCP ingestion, not direct low-level pipeline calls or every SQLite operation. The supervisor itself and remote MCP are not included.
- Earlier README architecture edits are preserved; unrelated .cursor/plans/ remains untouched. Existing public exports and stored data formats remain compatible.

## Next steps

1. Configure a local MCP host with an explicit library root and model environment when ready for live use.
2. Build the supervisor separately against the documented tools; keep conversation/planning state outside classifier domain storage.
