# Decisions — project-manager

## DEC-001: Bounded supervisor with sequential evidence writes
Date: 2026-10-01
Status: accepted
Context: Project management requires follow-up retrieval and persistent project state; classifier owns document storage. Studio expects independent typed servers.
Decision: TypeScript/Node, own SQLite database and tRPC server, Anthropic SDK. Capture → classifier ingestion → confirmation is sequential. Analysis is a supervisor loop with at most six model turns, calling classifier search and a validated report tool. No peer handoffs or shared runtime.
Consequences: Manager owns project IDs, notes, reports, and runs. Classifier owns library taxonomy/documents. The manager writes uniquely named Markdown into the configured classifier inbox, uses its typed server, verifies library identity, and never writes classifier tables. Pending notes and worker run IDs persist for retry. One mutation per project at a time.

## DEC-002: Initial model selection is provisional
Date: 2026-10-01
Status: accepted
Context: Current knowledge-work benchmarks are more relevant than coding rankings for project management.
Decision: Default to configurable claude-sonnet-5-5 with adaptive thinking, recommend Opus 5.5 for difficult analysis only after project-specific evaluation. See docs/architecture.md for sources and limitations.
Consequences: Public benchmark scores are selection evidence, not a local quality result. Offline tests use fake models and workers; live model quality remains unmeasured.
