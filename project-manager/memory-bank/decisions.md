# Decisions — project-manager

## DEC-001: Bounded supervisor with sequential evidence writes
Date: 2026-10-01
Status: superseded
Context: Project management requires follow-up retrieval and persistent project state; classifier owns document storage. Studio expects independent typed servers.
Decision: TypeScript/Node, own SQLite database and tRPC server, Anthropic SDK. Capture → classifier ingestion → confirmation is sequential. Analysis is a supervisor loop with at most six model turns, calling classifier search and a validated report tool. No peer handoffs or shared runtime.
Consequences: Manager owns project IDs, notes, reports, and runs. Classifier owns library taxonomy/documents. The manager writes uniquely named Markdown into the configured classifier inbox, uses its typed server, verifies library identity, and never writes classifier tables. Pending notes and worker run IDs persist for retry. One mutation per project at a time.

## DEC-002: Initial model selection is provisional
Date: 2026-10-01
Status: superseded
Context: Current knowledge-work benchmarks are more relevant than coding rankings for project management.
Decision: Default to configurable claude-sonnet-5-5 with adaptive thinking, recommend Opus 5.5 for difficult analysis only after project-specific evaluation. See docs/architecture.md for sources and limitations.
Consequences: Public benchmark scores are selection evidence, not a local quality result. Offline tests use fake models and workers; live model quality remains unmeasured.

## DEC-003: Scope is system design; architecture remains proposed
Date: 2026-10-01
Status: superseded by DEC-005
Context: User clarified they requested system design rather than implementation.
Decision: Remove the implementation and retain design-only documentation. Recommend a bounded project-manager supervisor, deterministic ingestion/state commits, and independent typed server boundaries. TypeScript/Node, SQLite and Sonnet 5.5 are proposed initial choices, subject to source/lifecycle requirements and local evaluation.
Consequences: Do not implement until explicitly requested. Classifier requires scoped metadata search, stable evidence IDs/read contract and idempotent intake before the proposed integration is complete. Prior runtime-specific decisions are superseded.

## DEC-004: Accuracy-first measurable modules
Date: 2026-10-01
Status: accepted
Context: User requested a narrower technical design focused on measurable accuracy rather than stack selection.
Decision: Define five logical modules with inspectable input/output contracts: evidence/project registration, retrieval/read, supported fact extraction, temporal reconciliation and grounded answers/clarification. Measure precision and required-fact recall together, isolate modules with reference inputs, then replay complete project histories. Compare one-pass versus bounded turns empirically. Stack and model choice remain supporting decisions rather than success criteria.
Consequences: Targets are proposed and unmeasured. Annotated source spans, dated state checkpoints, project-held-out evaluation and per-field results are needed before accuracy claims. Empty answers and timeouts cannot improve apparent accuracy. Remain design-only.

## DEC-005: Authorized accuracy-first local pilot
Date: 2026-10-05
Status: accepted
Context: The user explicitly requested implementation of the build plan after the prior design-only clarification.
Decision: Implement the five measurable modules with Studio Markdown/project selection, immutable targeted classifier storage, direct snapshot extraction, reviewed versioned state and approved-fact questions. Retain sequential intake/state writes and bounded question turns (six model turns, twelve tool calls, total five retrieved passages). Reuse TypeScript/Node, tRPC, SQLite and Studio; begin live evaluation with the configured Anthropic model, without a hidden model default.
Consequences: DEC-003's design-only boundary is superseded. Candidate facts remain pending until review; conflicts cannot produce definitive current answers; human edits have separate confirmation evidence. Development memory stays separate from runtime data. The 64-document/40-question corpus has five development and three frozen holdout projects; proposals are scored before simulated review, which never repairs omissions. Fixture scores do not justify live accuracy claims. Dedicated classifier library runs without a watcher. Live evaluations are manual and manager cost caps exclude separate classifier calls. Connectors, scheduling, forecasting, assignment and external actions are excluded.
