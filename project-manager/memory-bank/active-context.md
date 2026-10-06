# Active context — project-manager

## Current focus
Accuracy-first local pilot implemented and verified on 2026-10-05. The independent TypeScript/tRPC/SQLite manager integrates immutable classifier evidence, reviewed versioned state, approved-fact questions and a dedicated Studio workspace.

The local manager is running on port 8788 for the current Studio session, backed by the dedicated classifier on port 8789 and `project-manager/.data/evidence`.

## Verified baseline
- Manager checks and 85 tests pass; classifier checks, 223 tests and four existing evaluations pass; Studio checks and Webpack build pass.
- HTTP and browser coverage passes review isolation, retry/recovery contracts, human provenance, project switching, citations and evaluation-to-trace navigation.
- Corpus v2 has 64 documents/40 questions and five development/three frozen holdout projects. The fixture replay has zero failures; counts and limitations are in docs/verification.md and the recorded report.
- Models select approved fact IDs; disputed current fields remain withheld. Intake/state writes are sequential; questions allow up to six model turns/twelve tools with five total retrieved passages.

## Next steps
1. Configure the Anthropic model/key and the dedicated classifier library without a watcher, then run the documented manual live baseline.
2. Compare policies/models using the frozen holdout and explicit budget/settings; retain extra turns only for improved live results without increased unsupported claims.
3. Label and freeze representative sanitized project notes separately before real-world accuracy claims.

## Measurement boundary
The recorded fixture grammar/evidence simulation measures controlled behavior, not LLM accuracy or live embedding relevance. Live gates and representative-note accuracy remain unmeasured. Manager-model evaluation caps do not include separate classifier costs. The user authorized an atomic commit on `codex/project-manager` and integration into local `main`; remote publication remains separate.
