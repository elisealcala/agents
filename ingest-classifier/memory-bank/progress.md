# Progress — ingest-classifier

## Status

Current: M1 Zero-Loss Core Pipeline complete and verified (issues #2–#8). M2 not started.
Next: M2 tickets, starting with persisted live categories (#10).

## Checklist

- [x] Replace `AGENT_NAME` placeholders
- [x] Record runtime/architecture in `decisions.md` (`DEC-001`)
- [x] Record providers in `decisions.md` (`DEC-002`)
- [x] TypeScript package + `ModelClient` providers
- [x] Smoke CLI (`pnpm start`)
- [x] Unit tests (no live network)
- [x] GitHub roadmap: milestones M1–M3, issues #1–#20 (`DEC-003`)
- [x] M1 Zero-Loss Core Pipeline (issues #2–#8)
- [ ] M2 Adaptive Memory & Dynamic Taxonomy (issues #10–#14)
- [ ] M3 Offline Re-clustering & Interactive Retrieval (issues #16–#20)

## Log

### 2026-09-02

- Copied from `_template/`.
- First slice is model picker only (OpenAI / Anthropic / xAI via env). Classification APIs are out of scope.
- Added pnpm TypeScript package: `loadConfig`, `createModelClient`, openai / anthropic / xai providers, `pnpm start` smoke CLI.
- Vitest: 10 tests, no live API calls. Pick a model with `INGEST_PROVIDER` + `INGEST_MODEL` and the matching API key.

### 2026-09-03

- Product roadmap on GitHub (not Linear): 3 milestones, 3 epics, 17 child issues. `DEC-003`.
- M1 exit gate: 100% valid `.md` sorted + audit log. M2: 50+ files, no duplicate themes. M3: suggest splits + grounded Q&A.
- Did **not** implement inbox/classifier. Next work is milestone 1 issues.

### 2026-09-04

- Completed M1 issues #2–#8: five-category folder contract, polling inbox, lossless Markdown parsing, schema-validated classification with retry, collision-safe verified moves, SQLite record/event audit trail, and offline exit gate.
- Low-confidence schema-valid notes fall back to `reference_material`; invalid replies and invalid UTF-8 fail closed and remain in the inbox.
- Verification: typecheck passed; 70/70 tests passed; `pnpm eval:m1` passed with 20/20 valid notes sorted, one invalid note retained/failed safely, and 20 complete audit rows.
- Added `DEC-004` through `DEC-006`. Next work is M2 #10.
