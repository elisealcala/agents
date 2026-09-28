# Active context — ingest-classifier

## Current focus

Repository refactor (2026-09-25, DEC-020 – DEC-023): kebab-case filenames throughout, evaluations renamed for what they gate, Biome as the single lint and format tool, and a reconciled verbosity standard applied across `src/` and `evals/`. No product behavior changed.

Nested categories (2026-09-24, DEC-019): adaptive classification files a note in the most specific matching category, or creates one child under the closest existing category. Seeds stay roots. Sibling dedup does not cancel a child because it resembles its parent. The fixed pipeline stays flat. Clustering still does not move files.

System-message behavior is unchanged: each call sends instructions and input together in a single user message, and retries do not carry message history. Supporting separate system instructions would require extending `ModelClient` and the adapters.

## Verified status — 2026-09-25

- `pnpm check` (types, Biome lint with warnings failing, Biome format) passes. 202 tests across 24 files pass.
- All four evaluations pass: `eval:fixed-taxonomy` (20 sorted), `eval:adaptive-taxonomy` (57 sorted, 7 categories, no duplicate siblings), `eval:retrieval-and-clustering`, and `eval:mcp-worker` (six tools, partial failure, `LIBRARY_BUSY` contention). No live model calls.
- `pnpm install --frozen-lockfile` resolves in `ingest-classifier` and `_template/presets/typescript` after the ESLint removal, checked against a negative control.
- The MCP `outputSchema` is now a discriminated union rather than a flat object. The worker evaluation validates every response against it and passes.
- The adaptive prompt is byte-identical: the interpolated threshold renders as exactly `0.80`.

## Boundaries

- Watch holds the ingestion lock for its lifetime. After an abrupt termination, stale locks require manual removal after confirming no active ingestion remains.
- The lock coordinates application/CLI/MCP ingestion, not direct low-level pipeline calls or every SQLite operation.
- `src/index.ts` keeps every export it had and adds 27; package command names are unchanged apart from the four deliberate `eval:*` renames.
- Error strings that surface in a report or an audit row stay short and path-free — the surrounding record carries the path and tests assert the string exactly.
- `AuditRecord` is deliberately not a hard discriminated union; see DEC-023 for why legacy `ok` rows must stay readable.
- Type-aware lint rules are unavailable until Biome ships equivalents (DEC-020).
- Files already stored in a parent folder are not relocated when a more specific child is created later.

## Next steps

1. Decide on `anthropic.ts` `max_tokens: 256`. OpenAI and xAI set no cap, and the adaptive prompt embeds the whole live taxonomy, so a large library risks truncation and a parse failure on Anthropic only. The constant is named and documented; the value is untouched pending a decision.
2. Run `pnpm run -- --root ./my-library` with Markdown notes in `inbox/` and confirm a narrow technical note creates a child under the closest seed. `my-library/` exists locally and is untracked.
3. Configure a local MCP host with an explicit library root and model environment when ready for live use.
4. Build the supervisor separately against the documented tools; keep conversation/planning state outside classifier domain storage.
