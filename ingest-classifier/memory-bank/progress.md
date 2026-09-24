# Progress — ingest-classifier

## Status

Current: Adaptive classification files notes in a category tree (DEC-019). M1 stays a flat seed taxonomy.
Next: Try a live library run with narrower technical notes and confirm children land under the closest parent.

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
- [x] Document the runtime flow and pieces with a Mermaid diagram

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

### 2026-09-08 — Architecture diagram

- Added a Mermaid overview of adaptive intake, provider calls, SQLite memory, corrections, retrieval, and suggestion-only clustering to the README.
- Added a component-to-code table and explained failure handling, local embeddings, and the distinction between runtime SQLite memory and the development memory bank.
- Clarified that the 0.50 confidence fallback belongs to the fixed-taxonomy M1 pipeline; the production adaptive pipeline uses category fit.
- No runtime code changed. The prior structure/tooling work was pushed in `04d0137`; this documentation addition is local pending review.
- Documentation review confirmed component links, code alignment, and whitespace. Clarified that retry applies to classification and missing-vector repair applies to document embeddings. Mermaid syntax was reviewed statically; no renderer is installed.

### 2026-09-08 — Diagram aligned with source folders

- Replaced the process-flow diagram with a source containment map: root entry files plus all seven src folders, showing actual implementation filenames and responsibilities.
- Kept the command flow in concise prose below the diagram and separated classifier/provider rows in the component table.
- Explicitly placed evals/ and memory-bank/ outside the src map; colocated tests are omitted for readability.
- Recorded the source-map presentation convention in DEC-014. Documentation-only changes remain local.

### 2026-09-09 — Diagram separated by concern

- Replaced the file-tree graphic with responsibility boxes and their main calls: orchestration, classification, taxonomy, file handling, storage, search, and model providers.
- Removed src and implementation filenames from the diagram while retaining the component-to-code table.
- Recorded the clarified preference in DEC-015, superseding DEC-014. Runtime code is unchanged; documentation changes remain local.

### 2026-09-09 — Supervisor interface discussion

- Explained how a supervisor can call the existing CLI or reusable TypeScript exports, and when HTTP, MCP, or queued jobs would be useful alternatives.
- Identified adapter requirements: structured output, per-file failure inspection, timeouts, and lifecycle ownership for watch; no supervisor or interface changes were implemented.
- Recommended starting with a small named-operation interface and choosing direct calls or a local CLI adapter based on the supervisor runtime. This is a proposal, not an accepted architecture decision.
- Saved the broader explanation and adapter canvas in the existing Obsidian architecture note.

### 2026-09-09 — Current CLI contract versus MCP

- Confirmed the CLI prints command-specific JSON and exposes per-file statuses, but has no uniform result/error envelope, guaranteed JSON-only stdout, advertised input/output schemas, or MCP server.
- Explained that MCP offers discovery and schema-defined tool calls, while application code still owns result validation and partial-failure semantics.
- Recommendation remains conditional: keep the CLI; add a thin MCP adapter over shared operations when interoperability with an MCP-capable supervisor is needed. No interface changes were requested or implemented.

### 2026-09-10 — Multi-agent architecture review

- Validated supervisor-worker, handoff, and blackboard as useful, combinable patterns rather than an exhaustive industry taxonomy; distinguished coordination from invocation protocols and durable execution.
- Corrected handoff context assumptions, Redis Pub/Sub delivery guarantees, and Temporal's role as a durable workflow runtime rather than an event broker.
- Recommended supervisor-worker with validated native TypeScript operations for an owned supervisor in the same runtime/deployment. Keep the CLI; consider MCP for compatible external clients, or HTTP/RPC for independent services. Recommendation only, with no new DEC entry.
- Identified integration requirements from the existing implementation: retain classifier data ownership, separate supervisor conversation state, serialize ingestion runs per library, inspect partial failures, and use bounded calls instead of watch.
- No runtime changes, dependency additions, model calls, or verification commands were needed for this advisory review.

### 2026-09-14 — Standalone and supervised operation goal

- User confirmed orchestrator-worker as the target while preserving independent classifier use; recorded DEC-016.
- Rechecked CLI, public exports, package metadata, and adaptive pipeline guards. Existing exports permit direct supervisor calls, but setup/cleanup remains in CLI branches and there is no unified validated operation contract.
- Explained the proposed shared application interface, explicit configuration/dependencies, structured partial-failure results, and lifecycle/concurrency boundaries. Supporting simultaneous CLI/watch and supervisor ingestion needs coordination beyond per-instance guards.
- No runtime implementation was requested in this clarification; code and existing local README changes are preserved.


### 2026-09-15 — Standalone CLI and MCP worker implementation

- User approved the local, single-library MCP plan with immediate rejection of competing ingestion; recorded DEC-017 and DEC-018.
- Added shared application operations and Zod input/output contracts, a lazy model factory, structured reports, and resource lifecycle ownership. Reused the existing CLI presentation and all public exports.
- Added the official MCP SDK v2 stdio adapter with six tools and an offline client evaluation; CI now includes the MCP evaluation.
- Added a canonical-root filesystem lock and graceful draining. Hardened storage-constructor cleanup and adaptive batch settling so failed files cannot cause premature database closure while other files are active.
- README now documents standalone and supervised usage, concrete inputs/results, connection configuration, and manual recovery of abandoned ingestion locks.
- Test-writer coverage and verifier checks are pending; no live model calls have been made.

- Verification completed after batched fixes: frozen install, typecheck, ESLint, Biome, and 198 tests across 24 files pass. All four canonical evaluations pass (M1, M2, M3, MCP), with zero live model calls.
- Fixed the SDK client versionNegotiation option, response-ID narrowing, and cleanup error propagation; corrected retry-message test expectations and made the offline CLI provider loader compose asynchronously with tsx.
- Independent probes confirmed modern/legacy negotiation, protocol-only stdout from direct Node and pnpm launches, response delivery and lock release during EOF/SIGTERM, and side-effect-free public imports (50 runtime exports, preserving existing exports).
- Tests also cover real standalone run/ask results, partial batches retaining the original raw-array/exit-zero behavior, watch locking, symlink roots, and conservative abandoned-lock handling. No lingering test/MCP child processes remained after verification.
- Verifier used escalation for canonical pnpm evaluation commands because the local sandbox restricts tsx IPC. No code, model, or data failures remain. Changes remain local; no commit or push was requested.


### 2026-09-15 — Publish the verified MCP worker release

- User requested committing and pushing the verified implementation and pending classifier documentation to main.
- Release includes the shared operations, six-tool local MCP server, CLI compatibility, ingestion lock/lifecycle behavior, offline evaluations, tests, and CI update.
- Retained the completed verification: 198 tests, quality checks, frozen installation, and all four offline evaluations pass; no runtime changes were made during publication.
- Excluded the unrelated untracked .cursor/plans/ directory.

### 2026-09-18 — Provider message format lookup

- Located provider selection in `src/providers/createClient.ts` and request/response adaptation in `openai.ts` and `anthropic.ts`; xAI reuses the OpenAI adapter.
- Confirmed both adapters currently send one user message with string content. Differences are SDK endpoint, Anthropic's max_tokens, and response text extraction. The shared contract remains `complete(prompt: string): Promise<string>`.
- No runtime changes or checks were needed; this was a source lookup.

### 2026-09-18 — Provider sanitization lookup

- Confirmed there is no provider-specific input sanitization: adapters forward the prompt string directly. The ingestion path performs shared UTF-8 validation and Markdown-to-text cleanup before prompt construction.
- Classification responses receive shared JSON/field validation and normalization after provider text extraction. No explicit sensitive-data redaction or prompt-injection sanitization was found in the traced completion paths; retrieval interpolates questions and stored context into its prompt.
- No runtime changes or verification commands were needed.

### 2026-09-18 — System messages and turns clarification

- Clarified that the question concerns system instructions and conversational turns, not content sanitization. Source search confirmed no system-message conversion or conversation-history layer in classifier model calls.
- Each completion sends one user message containing instructions plus input. ModelClient accepts only a prompt string; classification retries construct a fresh request without prior assistant messages.
- No implementation changes were requested.

### 2026-09-24 — Nested category classification

- Categories store `parent_id`. A flat library migrates in place: existing rows, including the five seeds, keep `parent_id` null so their folders stay at `library/<folder>/`.
- `run` and `watch` file a note in the most specific existing category when that category matches as a whole. A narrower note creates one child under the closest existing category and moves the file there. A later note can add one more level under that child.
- Dedup compares a proposal only with that parent's children. Similarity to the parent does not cancel the child. The 0.85 threshold still reuses a near-duplicate sibling.
- A proposal may have `fit_score` above 0.80. That replaces the proposal half of DEC-007 for the adaptive path only. The fixed M1 classifier is unchanged.
- Notes already sitting in a parent are not moved when a child appears later. Clustering remains suggestion-only (DEC-011).
- Recorded DEC-019. README library contract shows the nested layout.
- Verification: `pnpm check` passed. 202 tests across 24 files passed. `pnpm eval:m2` passed with 57 sorted notes, equipment maintenance and recipes nested under `personal_ideas`, and no duplicate sibling pairs. No live model calls.
