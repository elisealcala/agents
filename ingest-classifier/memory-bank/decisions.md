# Decisions — ingest-classifier

## DEC-001: TypeScript modular package

Date: 2026-09-02
Status: accepted
Context: This collection does not impose a stack. ingest-classifier needs a runtime before any classification work.
Decision: TypeScript (pnpm, tsx, vitest), modular `src/` — not LangGraph and not Python for this agent.
Consequences: Later slices (classify file/records) stay in this package and call `ModelClient`.

## DEC-002: OpenAI, Anthropic, and xAI via env

Date: 2026-09-02
Status: superseded (DEC-025)
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

## DEC-007: Dedicated 80% live-category fit score

Date: 2026-09-04
Status: accepted
Context: Dynamic classification needs to distinguish certainty in the response from fit against the current taxonomy.
Decision: Use a dedicated `fit_score`. Existing categories require `fit_score > 0.80`; proposals require `fit_score <= 0.80`. `confidence_score` continues to describe confidence in the overall classification response.
Consequences: The rule is schema-enforced and every prompt is built from SQLite category rows rather than a hardcoded category list.

## DEC-008: Local deterministic category embeddings

Date: 2026-09-04
Status: accepted
Context: All configured completion vendors must work, Anthropic does not expose a matching embedding API, and CI/evals cannot require live network calls.
Decision: Use normalized 256-dimensional feature-hash embeddings (`local-hash-v1`) for category deduplication, persisted in SQLite. Default duplicate threshold is strictly greater than 0.85 and is configurable through `INGEST_CATEGORY_DEDUP_THRESHOLD` or the library API.
Consequences: Dedup is fast, private, vendor-independent, and reproducible. M3 document retrieval will use the same embedding family unless superseded.

## DEC-009: Category row and folder precede file movement

Date: 2026-09-04
Status: accepted
Context: SQLite and filesystem operations cannot share a transaction, but a file must never move into a category that is absent from the database.
Decision: Insert the category row, create the matching folder, and only then use the M1 verified move. Folder-creation failure compensates by deleting the new row; file-move failure leaves the row and its folder valid for retry.
Consequences: A moved note always has a durable category record, and concurrent proposals are serialized through dedup so they cannot create duplicate themes.

## DEC-010: Five recent corrections as prompt examples

Date: 2026-09-04
Status: accepted
Context: Human corrections should influence later classifications without growing every prompt indefinitely.
Decision: Persist every correction in SQLite and inject the five most recent records into adaptive classification prompts. The default limit is an exported constant and can be overridden through the library API.
Consequences: Corrections survive restarts, prompt size stays bounded, and the first CLI version records intent without automatically moving an existing file.

## DEC-011: Suggestion-only deterministic two-way clustering

Date: 2026-09-04
Status: accepted
Context: M3 needs actionable folder split suggestions without silently reorganizing the library or adding a native clustering dependency.
Decision: Run deterministic cosine k-means with two clusters inside sufficiently populated categories. Emit separation, dominant-term labels, counts, and example filenames to JSON; never move files.
Consequences: The job is reproducible and inspectable. Applying, naming, or expanding a suggested taxonomy remains a human decision.

## DEC-012: Stored-vector retrieval with a relevance floor

Date: 2026-09-04
Status: accepted
Context: Natural-language answers must reuse stored embeddings, cite real files, and fail honestly when the library has no grounding.
Decision: Embed only the query, retrieve up to five documents above cosine 0.20 by default, and send only their summaries/snippets/paths to the selected completion model. Attach citations from retrieved records in deterministic code.
Consequences: A model cannot add unverified paths to the returned citation list; empty and irrelevant questions return no sources.

## DEC-013: Responsibility folders and independent quality gates

Date: 2026-09-08
Status: accepted
Context: The flat source folder became difficult to navigate, and the project had type checking but no lint or formatting gates.
Decision: Group modules and colocated tests into classification, pipelines, files, storage, taxonomy, search, and providers; move evals out of src. Preserve CLI commands and src/index.ts exports. Pin TypeScript 6.0.3 for typescript-eslint compatibility, ESLint for recommended code rules, and Biome for formatting only. Run checks, tests, and M1-M3 evaluations locally and in GitHub Actions.
Consequences: Internal import paths change, but runtime behavior and database formats do not. Code, tests, evaluation runners, and TypeScript tool configuration are type checked. Dependency and formatting changes remain local to this package.

## DEC-014: README architecture diagram mirrors source layout

Date: 2026-09-08
Status: superseded (DEC-015)
Context: The process-flow diagram did not help the user connect the architecture to the reorganized src folders.
Decision: Use a Mermaid containment map with one box per src folder, actual implementation filenames, and responsibilities; show root entry files together. Explain execution and cross-folder collaboration in the accompanying prose.
Consequences: Diagram arrows mean containment, not runtime order or dependency. Keep the map synchronized with source organization; omit colocated tests for readability and keep evals/ and memory-bank/ outside src.

## DEC-015: Architecture diagram shows collaborating concerns

Date: 2026-09-09
Status: accepted
Context: The user clarified that folders should inform the separation of concerns, without showing src or a file tree in the image.
Decision: Show orchestration, classification, taxonomy, file handling, storage, search, and model providers as responsibility boxes, connected by their main calls. Keep paths and filenames in the component table and source-layout section.
Consequences: Supersedes DEC-014. Diagram arrows represent collaboration rather than containment or strict execution order; no src root or implementation filenames appear in the diagram.

## DEC-016: Standalone agent and orchestrator worker

Date: 2026-09-14
Status: accepted
Context: The user wants ingest-classifier to operate independently and beneath a supervisor using the orchestrator-worker pattern.
Decision: Preserve standalone CLI operation and support a supervisor invoking the same classifier capabilities as bounded worker operations. The classifier retains ownership of classification, taxonomy, library files, and domain storage; the supervisor owns overall task planning and conversation state.
Consequences: Share application behavior between entry points and preserve existing commands/exports. A validated operations interface, lifecycle handling, and per-library ingestion coordination are proposed integration work. This decision selects the pattern and dual-use goal, not MCP, a framework, or a deployment topology. No runtime changes are implemented yet.


## DEC-017: Local MCP over shared application operations

Date: 2026-09-15
Status: accepted
Context: The user approved preparing the classifier as an orchestrator worker with MCP, while retaining its standalone CLI; the supervisor itself is separate work.
Decision: Serve six schema-defined tools over local stdio for one startup-configured library, using the official TypeScript MCP SDK v2 and Zod. Share application operations and resource lifecycle with the CLI. Return success/partial/error envelopes and coded failures to MCP, while retaining command-specific CLI output. Keep configured model calls inside the worker, and permit discovery/local-only operations without model credentials.
Consequences: A new application layer and MCP adapter wrap existing classification/storage behavior. MCP does not expose watch, arbitrary roots, provider credentials, or report output paths as tool arguments. No remote transport, database migration, or supervisor implementation is included.

## DEC-018: Reject competing ingestion with a conservative local lock

Date: 2026-09-15
Status: accepted
Context: Per-pipeline guards cannot coordinate a standalone watcher and a supervisor process using the same library. The user chose rejection rather than queuing.
Decision: Acquire an atomic lock directory under the canonical library root before opening ingestion resources; hold it through one run or the full watch lifetime. Return LIBRARY_BUSY on contention. Wait for active processing before cleanup and release the lock normally; do not automatically expire abandoned locks.
Consequences: Symlink aliases coordinate and different libraries remain independent. After a crash, an operator must confirm no ingestion is active before removing the stale lock. This guards ingestion through application/CLI/MCP entry points, not direct low-level pipeline usage or every other SQLite operation; no durable job or crash-recovery guarantee is added.

## DEC-019: Nested categories during classification

Date: 2026-09-24
Status: accepted
Context: Broad seed categories, especially Architecture & Code, absorb narrower technical notes because a fit above 0.80 blocks a new category. Split suggestions stay a report and do not create folders.
Decision: Store `parent_id` on categories. Seeds remain roots. Adaptive classification files a note in the most specific existing category when that category matches as a whole. A narrower note creates one child under the closest existing category. Sibling dedup still uses the 0.85 threshold. A high fit against the parent does not block the child. This replaces the proposal half of DEC-007 for the adaptive path only. The fixed M1 classifier stays flat. Existing files are not moved when a later child appears. Clustering remains suggestion-only (DEC-011).
Consequences: New folders nest under `library/`, for example `library/architecture-code/caching/redis/`. Flat libraries migrate with `parent_id` null so current seed paths stay valid. Folder names are unique among siblings.

## DEC-020: Biome is the only linter and formatter

Date: 2026-09-25
Status: accepted
Context: DEC-013 ran ESLint for code rules and Biome for formatting as independent gates. Two tools meant two configs, two ignore lists, and a TypeScript version pinned to the ESLint TypeScript integration's supported range.
Decision: Biome owns lint and format. `eslint.config.mjs` is deleted and `@eslint/js`, `eslint`, `globals`, and `typescript-eslint` are removed from both `ingest-classifier` and `_template/presets/typescript`. `pnpm lint` is `biome lint --error-on-warnings .` so warnings still fail, matching the old `--max-warnings 0`. `noNonNullAssertion` is turned off: Biome puts it in `recommended`, typescript-eslint has it in `strict`, so leaving it on would have tightened the gate rather than preserving it. `tsc --noEmit` remains the type gate. Supersedes DEC-013's two-tool split; the responsibility-folder half of DEC-013 stands.
Consequences: One config, one ignore list. Rules that only typescript-eslint offers are gone, so type-aware lint rules are unavailable until Biome ships equivalents. Script names and the `pnpm check` contract are unchanged.

## DEC-021: Kebab-case filenames and evaluations named for their gate

Date: 2026-09-25
Status: accepted
Context: Filenames mixed camelCase (`adaptivePipeline.ts`, `createClient.ts`) with single-word lowercase. Evaluations were named for roadmap milestones (`m1`, `m2`, `m3`), which said nothing about what they check.
Decision: Every file is kebab-case. Evaluations are named for what they gate: `fixed-taxonomy`, `adaptive-taxonomy`, `retrieval-and-clustering`, `mcp-worker`, with pnpm script names matching the file basenames. Milestone IDs stay in this bank as history and are mapped to the new names in a README table.
Consequences: Imports carried explicit `.ts` extensions, so the rename was mechanical and tsc proved it complete. CI step names and README commands were updated. Existing dated entries in `progress.md` keep their original `eval:m1`-style wording, because the log records what was run at the time.

## DEC-022: Verbosity means explicit types plus stated reasons

Date: 2026-09-25
Status: accepted
Context: "Make the code more verbose" is ambiguous. Two TypeScript reviews were commissioned and reconciled. They independently agreed that error messages were already strong, that blanket naming conventions would break the `snake_case` model and SQLite wire formats, that domain vocabulary (`db`, `topK`) should not be expanded, and that naming the policy thresholds was the riskiest item because those numbers are the product.
Decision: Verbosity is (a) explicitness the compiler checks and (b) reasons a reader cannot reconstruct from the code. Concretely: `isolatedDeclarations` and `noUncheckedIndexedAccess` are on, so every exported symbol carries a written type; inline option literals of three or more members become named types; every policy threshold, retry budget and iteration cap is a named constant, enforced by Biome's `noMagicNumbers` scoped to non-test `src/**`; every non-test module has a header stating its responsibility and citing its `DEC-NNN`; exported symbols carry TSDoc that adds an invariant, side effect or failure mode rather than restating the signature. Comments state why, never what. Rejected: TSDoc on self-describing record types, `@param`/`@returns` duplicating the signature, Biome's `useExplicitType` (it annotates every inline callback), removing non-null assertions, and runtime-validating SQLite row casts.
Consequences: Error strings that surface in reports or audit rows stay short and path-free, because the surrounding record already carries the path and tests assert the string exactly. `SeedCategoryId` is now written as a union instead of inferred from `SEED_CATEGORIES`, so adding a seed means editing both. Zod schemas carry `z.ZodType<T>` annotations against hand-written wire types, which is what `isolatedDeclarations` requires and what keeps the contract readable.

## DEC-023: OperationResult is a three-arm union; AuditRecord is a narrowed subtype

Date: 2026-09-25
Status: accepted
Context: `OperationResult` was `{ status; data: T | null; error: OperationError | null }`, which permitted nonsense states and forced `result.error?.code ?? "OPERATION_FAILED"` fallbacks the compiler could not discharge. `AuditRecord` carried eight nullable fields whose invariant was already enforced in SQL by `complete()`, so `backfillDocumentEmbeddings` needed a guard purely to satisfy the compiler.
Decision: `OperationResult<T>` becomes three arms: `success` carries data and no error; `partial` carries both; `error` carries an error and carries data only for a batch in which every item failed, because `batchResult` still reports what it attempted. Every non-success arm therefore has a non-null error, and the CLI fallback is deleted. `AuditRecord` keeps its shape and gains a `CompletedAuditRecord` narrowed subtype plus an `isCompletedAuditRecord` predicate, rather than becoming a hard discriminated union.
Consequences: `resultSchema` now builds a `z.discriminatedUnion`, so the JSON Schema advertised as each MCP tool's `outputSchema` is a union rather than a flat object; the MCP worker evaluation validates every response against it and passes. `AuditRecord` was deliberately not split into union arms: a database written before the `complete()` guard existed can hold an `ok` row with gaps, and a hard union would force `mapRow` either to drop such rows or to throw. The predicate keeps them readable and countable, and backfill still reports them as failures exactly as before.

## DEC-024: The local scratch library stays untracked

Date: 2026-09-29
Status: accepted
Context: `./my-library` is the README example root. Running the classifier there creates `ingest-classifier.sqlite` plus its WAL sidecars, and later runs add notes, a lock directory, and `cluster-suggestions.json`. Those files showed up as untracked.
Decision: Gitignore the whole `ingest-classifier/my-library/` directory. The SQLite file remains the library database (no Docker, no separate server). Evaluations keep using temporary directories.
Consequences: Personal notes dropped into that library are also untracked. A library meant to be shared needs a different root that is not named `my-library`.

## DEC-025: Code owns the organizing sequence; Anthropic tools only place the note

Date: 2026-09-29
Status: accepted
Context: Classification sent one user message and parsed JSON. A free-choice librarian that picks among ingest, search, ask, and clustering would need prompt guidance to stay on task, and it could still skip a step. Organizing a note already follows one sequence.
Decision: Anthropic is the only model provider. `INGEST_MODEL` and `ANTHROPIC_API_KEY` are required; `INGEST_PROVIDER` is gone. Supersedes DEC-002 and the multi-provider half of DEC-006. The pipeline still parses, deduplicates, moves, and audits. The classify step is a system prompt plus a tool loop: `list_categories`, `search_similar_notes`, then exactly one of `file_existing` or `propose_child`. The fixed path omits `propose_child`. Terminal tools return a placement; they do not create folders or move files. Invalid tool input is a tool error and the loop continues. An attempt that ends without a placement uses the existing retry budget and does not keep that attempt's history. Grounded answers stay a system prompt plus a user message, with no tools.
## DEC-026: Local studio server records traces without changing CLI or MCP

Date: 2026-10-01
Status: accepted
Context: The studio needs to run the six application operations, edit the organizer prompt and thresholds, read library memory, and show the tool loop. `runTools` returned nothing a caller could watch, and the prompt and fit threshold were constants.
Decision: `pnpm serve` starts a tRPC server on `127.0.0.1`. An optional trace observer records model turns and organizer tool calls, including rejected calls and discarded retries, in `studio_runs` and `studio_spans` in the library database. Prompt, fit threshold, dedup threshold, and example limit overrides live in `studio_settings` in that same database. Unset values keep the built-in defaults. CLI and MCP pass no observer and no overrides.
Consequences: The studio imports `AppRouter` from `ingest-classifier/server` and does not call the pipeline in-process. Organizer tools are spans, not procedures. The server TypeScript project disables `isolatedDeclarations` because the router type is inferred.

## DEC-027: One organizer agent, and the adaptive classifier is a PreToolUse hook

Date: 2026-10-01
Status: accepted
Context: A second category agent would review the placement, but the review rules are already deterministic. The useful agent shape is the one in Claude's tool-use guide: a system prompt, tools, and a loop. Recent filings were not visible to that loop.
Decision: The adaptive path is one agent. It calls `list_recent_filings`, then `search_similar_notes`, then `list_categories`, and finishes with `file_existing` or `propose_child`. The agent chooses the best existing category, or the parent of one new child. It does not open a new root. The adaptive classifier runs as a `PreToolUse` hook on the two finishing tools, using the Claude Agent SDK hook contract: allow, or deny with a reason the model sees. Lookup tools are not hooked. Sibling dedup, the folder, and the move stay in the pipeline. The worked example is `docs/building-the-agent.md`.
Consequences: A recent streak of filings cannot by itself choose the category; the prompt tells the agent to follow similar notes and corrections when they disagree. A denied placement does not record and does not move the file. The fixed-taxonomy path does not register this hook and does not offer `list_recent_filings`.

## DEC-028: Immutable project evidence is an additive classifier boundary

Date: 2026-10-05
Status: accepted
Context: The accuracy-first project manager requires reliable source identity, project isolation, inspectable citations and duplicate-safe retries while preserving independent classifier operation.
Decision: Store immutable original Markdown snapshots and project/source/version associations in additive SQLite tables before classification. Bind idempotency keys to stable evidence references and reject conflicting content. Reuse the production adaptive flow for exactly one registered inbox file under the existing lock, with recovery for interrupted filing. Expose bounded worker operations and additive tRPC evidence procedures; keep existing CLI commands and six-tool MCP discovery unchanged. Project-scoped SQL filtering happens before provider compatibility checks, ranking and truncation. Search persists paragraph-aware chunks up to 1,500 UTF-16 units and returns at most five passages using the existing embedding provider. Full reads return the immutable snapshot, and repair/backfill for associated evidence uses that snapshot. Manager facts, reviews and conversations remain owned by the project-manager agent.
Consequences: The project-evidence server uses a dedicated library without a watcher. Stored evidence with failed classification/indexing returns a partial receipt, remains readable and can be retried by reference. Search reports incomplete embedding coverage. Legacy unassociated documents stay outside project searches. Stable source offsets and checksums survive edits to taxonomy copies; no embedding-method upgrade is assumed by this integration.
