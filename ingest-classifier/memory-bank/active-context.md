# Active context — ingest-classifier

## Current focus

Local classifier servers are running on ports 8787 (ordinary `my-library`) and 8789 (dedicated project evidence) for the current Studio session. Both identity endpoints responded on 2026-10-05.

Project evidence boundary (2026-10-05, DEC-028): `ingest-classifier/evidence` and additive tRPC `evidence.*` operations now support project-scoped immutable note registration, targeted adaptive filing, bounded passage search, full snapshot reading and retry/repair. Source identity, checksum and snapshots persist before classification. Project-manager state and reviews remain outside this package. Coordinated implementation is complete here; test-writer coverage and verifier checks are pending in the parent task.

Unused-code pass (2026-10-01): removed `SpanStatus`. The rest of the package is still called from production, evals, or tests.

Organizer agent (2026-10-01, DEC-027): one Claude tool-calling agent places each note. It starts with recent filings, then similar notes, then the taxonomy, and finishes with `file_existing` or `propose_child`. The adaptive classifier is a `PreToolUse` hook on those two finishing tools. The walkthrough is `docs/building-the-agent.md`.

Local studio server (2026-10-01, DEC-026): `pnpm serve` exposes the six operations, library memory, and an optional trace of the organizer tool loop. CLI and MCP stay unchanged when no trace or settings override is set.

Nested categories (2026-09-24, DEC-019): adaptive classification files a note in the most specific matching category, or creates one child under the closest existing category. Seeds stay roots. Sibling dedup does not cancel a child because it resembles its parent. The fixed pipeline stays flat, omits `propose_child`, and does not register the placement hook. Clustering still does not move files.

## Verified status — 2026-10-05

- `pnpm check` passes. 223 tests pass, including targeted immutable evidence intake, retries, repairs, restart recovery, locks and project filtering.
- All four evaluations pass: `eval:fixed-taxonomy` (20 sorted), `eval:adaptive-taxonomy` (57 sorted, 7 categories, no duplicate siblings), `eval:retrieval-and-clustering`, and `eval:mcp-worker`. No live model calls.

## Boundaries

- Project evidence uses a dedicated library without a watcher; the existing per-library lock still rejects contention.
- Evidence search returns at most five 1,500-unit raw Markdown chunks with UTF-16 offsets and reports incomplete embedding coverage. Legacy unassociated documents cannot enter project search.
- Snapshot reads and project embedding repair never trust editable taxonomy files. Existing backfill prefers immutable snapshots for associated evidence.
- Source versions and idempotency keys are immutable bindings; conflicting content or source metadata is rejected rather than overwritten.

- Watch holds the ingestion lock for its lifetime. After an abrupt termination, stale locks require manual removal after confirming no active ingestion remains.
- The lock coordinates application/CLI/MCP ingestion, not direct low-level pipeline calls or every SQLite operation.
- CLI commands and MCP tools stay direct operations. There is no chat entry point that chooses among them.
- A `PreToolUse` deny does not record a placement and does not move the file. The model sees the reason and can call a finishing tool again inside the same attempt.
- A rejected organizing attempt starts a fresh tool loop and does not keep the rejected turn.
- Error strings that surface in a report or an audit row stay short and path-free — the surrounding record carries the path and tests assert the string exactly.
- `AuditRecord` is deliberately not a hard discriminated union; see DEC-023 for why legacy `ok` rows must stay readable.
- Type-aware lint rules are unavailable until Biome ships equivalents (DEC-020).
- Files already stored in a parent folder are not relocated when a more specific child is created later.

## Next steps

1. Manually evaluate project evidence retrieval with the manager's frozen corpus and configured model. Deterministic evidence tests and all four classifier evaluations pass; live project relevance remains unmeasured.

1. Start `pnpm serve -- --root ./my-library` and the studio (`../studio`, `pnpm dev`). File a note and confirm the trace can show `list_recent_filings` and a finishing tool.
2. Run `pnpm run -- --root ./my-library` with Markdown notes in `inbox/` and confirm a narrow technical note creates a child under the closest seed. `my-library/` is gitignored (DEC-024). Set `INGEST_MODEL` and `ANTHROPIC_API_KEY`.
3. Configure a local MCP host with an explicit library root and model environment when ready for live use.
