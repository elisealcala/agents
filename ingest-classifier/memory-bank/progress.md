# Progress — ingest-classifier

## Status

Current: M1-M3 remain implemented. Source organization and local/CI quality gates are implemented and locally verified.
Next: maintain quality and keep all three exit gates green.

## Checklist

- [x] Replace `AGENT_NAME` placeholders
- [x] Record runtime/architecture in `decisions.md` (`DEC-001`)
- [x] Record providers in `decisions.md` (`DEC-002`)
- [x] TypeScript package + `ModelClient` providers
- [x] Smoke CLI (`pnpm start`)
- [x] Unit tests (no live network)
- [x] GitHub roadmap: milestones M1–M3, issues #1–#20 (`DEC-003`)
- [x] M1 Zero-Loss Core Pipeline (issues #2–#8)
- [x] M2 Adaptive Memory & Dynamic Taxonomy (issues #10–#14)
- [x] M3 Offline Re-clustering & Interactive Retrieval (issues #16–#20)

- [x] Document and implement project structure and quality tooling
- [x] Verify project structure and quality tooling

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
- Completed M2 issues #10–#14: durable category rows and folders, live-taxonomy classification with the strict 0.80 fit rule, persisted local embeddings, configurable semantic deduplication, serialized novel-category creation, and the offline 57-file exit gate.
- Verification: typecheck passed; 134/134 tests passed; M1 remained green; `pnpm eval:m2` passed with 57/57 notes sorted, 57 complete audit rows, two sensible novel themes, later-note reuse, and zero duplicate category pairs.
- Added `DEC-007` through `DEC-009`. Next work is M3 #16.
- Completed M3 issues #16–#20: stored document clean text/summaries/vectors, legacy backfill, durable five-example correction memory, suggestion-only deterministic clustering, stored-vector grounded retrieval, and the end-to-end M3 gate.
- Verification: typecheck passed; 174/174 tests passed; M1 and M2 regression evals remained green; `pnpm eval:m3` passed with 12/12 embeddings ready, an actionable architecture split, cited caching Q&A, a persisted correction, and no clustering file moves.
- Added `DEC-010` and `DEC-011`. The complete GitHub roadmap is ready to close.

### 2026-09-07

- Fast-forwarded the completed 19-commit roadmap history from `cursor/ingest-classifier-model-picker` onto local `main` after confirming `origin/main` had no divergent commits.
- All 20 GitHub issues and milestones M1–M3 were already closed; final pre-merge verification remained typecheck, 174/174 tests, and all three evals passing.
- Next step is pushing the updated `main` branch to GitHub.

### 2026-09-08 — Project structure and quality tooling

- Moved modules and tests into responsibility folders and evaluation code to top-level evals/.
- Updated imports and command paths while preserving public exports and command names.
- Added ESLint, Biome, broader tsc coverage, compatible TypeScript 6.0.3, and GitHub Actions checks.
- Added `DEC-013`. Verification is pending; existing documentation edits are preserved.

- Verification completed: typecheck, ESLint, Biome, and 174 tests across 21 files pass. M1, M2, and M3 offline evaluations pass; all 35 runtime and 20 type exports are preserved. Deliberate type/lint/format violations fail as expected. Removed seven unused mock parameters and normalized one method signature formatting after the first verification batch.
