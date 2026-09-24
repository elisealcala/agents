# Active context — ingest-classifier

## Current focus

Nested categories (2026-09-24, DEC-019): adaptive classification files a note in the most specific matching category, or creates one child under the closest existing category. Seeds stay roots. Sibling dedup does not cancel a child because it resembles its parent. The fixed M1 pipeline stays flat. Clustering still does not move files.

System-message clarification (2026-09-18): the worker does not manage conversational model turns or translate system messages between providers. Each call sends instructions and input together in a single user message; retries do not carry message history. Supporting separate system instructions/history would require extending ModelClient and the adapters.

Latest lookup (2026-09-18): provider selection is in `src/providers/createClient.ts:23`; OpenAI and Anthropic request/response shapes are handled by their individual adapters. Both forward the same prompt string without provider-specific sanitization. Ingestion performs shared UTF-8 validation and Markdown cleanup (`src/files/markdown.ts`); classification validates and normalizes responses centrally. These steps do not provide sensitive-data redaction or prompt-injection sanitization. No runtime changes were requested.

The approved standalone CLI and local MCP worker interface is implemented and verified (DEC-016–DEC-018). Both entry points share validated application operations. MCP serves six tools for one configured library, with structured success/partial/error results. The user approved publishing this verified release to main. It includes the shared operations, local MCP server, standalone CLI compatibility, tests, evaluations, and documentation.

## Verified status — 2026-09-24

- Nested category classification (DEC-019) is implemented. Types, ESLint, and Biome pass. 202 tests across 24 files pass. `pnpm eval:m2` passes: 57 notes sorted, new themes nested under `personal_ideas`, no duplicate siblings. No live model calls.
- Earlier 2026-09-15 verification still stands for the MCP worker, M1, M3, and MCP evaluations, aside from the adaptive taxonomy path this change updates.

## Verified status — 2026-09-15

- Frozen installation on Node 22.22.0 / pnpm 10.9.0 passes.
- Types, ESLint and Biome pass; 198 tests across 24 files pass.
- All four canonical offline evaluations pass: M1 (20 sorted notes), M2 (57 sorted notes), M3 (12 embeddings and retrieval/corrections/clustering), and MCP (all six tools, partial failure and contention).
- Modern 2026-07-28 and legacy 2025-11-25 MCP negotiation, direct Node/pnpm startup, clean stdout, EOF/SIGTERM draining, lock release, and side-effect-free public imports are verified.
- Standalone run/ask/correct/cluster/backfill behavior and partial-batch exit semantics are covered with offline fixtures. No live model calls were made.

## Boundaries

- Watch holds the ingestion lock for its lifetime. After an abrupt termination, stale locks require manual removal after confirming no active ingestion remains.
- The lock coordinates application/CLI/MCP ingestion, not direct low-level pipeline calls or every SQLite operation. The supervisor itself and remote MCP are not included.
- Earlier README architecture edits are preserved. Category storage gained `parent_id`; flat databases migrate with a null parent. Public operation names stay the same. Adaptive proposals now require a parent id.
- Files already stored in a parent folder are not relocated when a more specific child is created later.

## Next steps

1. Run `pnpm run run -- --root ./my-library` with Markdown notes in `inbox/` and confirm a narrow technical note creates a child under the closest seed.
2. Configure a local MCP host with an explicit library root and model environment when ready for live use.
3. Build the supervisor separately against the documented tools; keep conversation/planning state outside classifier domain storage.
