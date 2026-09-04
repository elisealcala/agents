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
