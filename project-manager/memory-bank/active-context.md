# Active context — project-manager

## Current focus
Memory/source audit completed on 2026-10-28. Local chat MCP bridge (DEC-006) calls the same manager service as Studio. On 2026-10-07 the verifier passed checks and 105 tests, including twenty MCP cases; fixture replay and frozen-lockfile compatibility passed. Registration was recorded then; client tool availability is session-dependent. The user authorized publishing the bridge source, demo and corresponding memory/audit updates on 2026-10-28; they are included in that publication batch. Git references identify the result.

Live README demonstration stored/indexed one immutable snapshot and produced twelve pending proposals. No facts were approved. Two questions in one conversation returned clarification. The example exposed unsupported status inference from component existence/procedural instructions and missing project context in clarification; inspect docs/chat-demo-2026-10-07.md before expanding repository ingestion. These are quality gaps, not approved project facts.

Accuracy-first local pilot implemented and verified on 2026-10-05. The independent TypeScript/tRPC/SQLite manager integrates immutable classifier evidence, reviewed versioned state, approved-fact questions and a dedicated Studio workspace.

The 2026-10-07 session started the local manager on port 8788, dedicated classifier on 8789 with `project-manager/.data/evidence`, and Studio on http://localhost:3000. Current server availability was not checked in this audit. Runtime demo data lives in the ignored manager database/report, separately from this development bank.

## Audit verification — 2026-10-28
- Typecheck and lint pass. Formatting fails on two pre-existing ignored demo artifacts in `.data/`; runtime artifacts were left untouched.
- Initial restricted run passed 97/105 tests; eight MCP HTTP cases were blocked by localhost listener permissions. Before publication the verifier reran all 20 MCP tests with localhost listeners permitted: 20/20 pass. Combined with the earlier 85 non-MCP passes, all 105 current tests are covered.
- Candidate source/config formatting passes (29 files). The full format command still includes the two ignored demo artifacts above; those files are excluded from publication.
- Decision/file/reference validation and whitespace checks pass. No live model or current server-health measurement was performed.

## Verified baseline — 2026-10-05
- Manager checks and 85 tests pass; classifier checks, 223 tests and four existing evaluations pass; Studio checks and Webpack build pass.
- HTTP and browser coverage passes review isolation, retry/recovery contracts, human provenance, project switching, citations and evaluation-to-trace navigation.
- Corpus v2 has 64 documents/40 questions and five development/three frozen holdout projects. The fixture replay has zero failures; counts and limitations are in docs/verification.md and the recorded report.
- Models select approved fact IDs; disputed current fields remain withheld. Intake/state writes are sequential; questions allow up to six model turns/twelve tools with five total retrieved passages.

## Next steps
0. Check service/tool availability for the current session. Review the demo's pending proposals explicitly. Add labeled cases for procedural instructions versus task instances, explicit status evidence and context-aware clarification before changing prompts/contracts.
1. Configure the Anthropic model/key and the dedicated classifier library without a watcher, then run the documented manual live baseline.
2. Compare policies/models using the frozen holdout and explicit budget/settings; retain extra turns only for improved live results without increased unsupported claims.
3. Label and freeze representative sanitized project notes separately before real-world accuracy claims.

## Measurement boundary
The recorded fixture grammar/evidence simulation measures controlled behavior, not LLM accuracy or live embedding relevance. The single live README demo is exploratory; live gates and representative-note accuracy remain unmeasured. Manager-model evaluation caps do not include separate classifier costs. The original pilot and Studio CI fix were published; the MCP source and audit updates are included in the user-authorized 2026-10-28 publication batch.
