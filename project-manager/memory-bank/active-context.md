# Active context — project-manager

## Current focus
The system design was committed locally on `main` as `52b7dae` on 2026-10-30 at the user's request. No push was requested or performed. User then emphasized a deployed UI with no terminal interaction and requested a staged technical plan. DEC-009 and docs/implementation/README.md plus eight phase files define that plan; plans/0002-deployed-web-ui-implementation.md is the bank pointer. Plan files are created; runtime implementation has not started.

Primary product: authenticated hosted `/manager` UI reusing Studio, server-side same-origin access to the independent manager, persisted chat, priorities/work, QA evidence, inbox and browser connection/retry/pause operations. Private staging arrives in Stage 2, useful planning in Stage 4, followed by QA, protected merge/progress, proactive operation and full production acceptance. Stage 2 includes degraded authenticated setup before provider readiness; Stage 6 merge runs are controlled pilot only and unattended production requires Stages 7–8. Hosting vendor/domain/account/budget and actual identity/runner configuration remain stage inputs. Final plan verification passes (12 docs, 38 links/anchors, eight stages, whitespace; no material contradictions). Other component banks were not read or changed.

System design v1 completed on 2026-10-30 at the user's explicit request using system-design and orchestrator agents, independent cross-review, iterative tabletop and an executable offline design model. Canonical artifact: docs/github-delivery-system-design.md; validation/15-requirement register: docs/github-delivery-workflow-validation.md; model/report: docs/simulations/. DEC-008 records the chosen architecture. This is design work only; the manager runtime remains the prior offline pilot.

The design chooses one persistent manager/SQLite owner with durable jobs/outbox, explicit GitHub/Projects adapters and observations, typed user decisions, planner proposals, independent VM/microVM QA under trusted supervision, version-bound review/conditional merge, per-ticket contribution coverage, always-on hosting and meaningful public-safe bot mentions plus a private inbox. GitHub owner Projects access and repo App review identity are separate. User/Codex retain ticket-to-PR coding. No per-ticket/per-merge confirmation is added within delegated goals. Private ideas stay in Studio; unknown external writes reconcile before retry; external GitHub edits are not atomically locked with merges.

Initial tabletop found ten gaps. Cross-review found a false-positive notification dedup assertion and then PR-contribution/whole-ticket completion conflation in the model; both were corrected. Artifact verification found and fixed an additional inbox-acknowledgement retry case. Final model passes 41/41 selected scenarios, versus 9/41 for an intentionally incomplete strawman. Verifier confirmed exact fresh-report replay, Python syntax, whitespace, local links and requirement/count consistency, with no material contradictions. These are finite design consistency results, not tests of production code, model quality, GitHub permissions, real disk recovery, actual QA or alert delivery. R15 bank isolation is design/tabletop coverage only. README links the canonical artifacts.

The user clarified the two repos and intended workflow on 2026-10-30: `elisealcala/chore-design` and `elisealcala/agents`. DEC-007 and plans/0001-github-delivery-loop.md capture direct manager conversations, priorities/blockers/ideas, GitHub Projects and ticket descriptions, PR evidence intake, QA/reviews/change requests/approval, merge and progress updates. The user/Codex own ticket-to-PR coding. The initial QA structure question is resolved by DEC-008; all of this remains a target rather than implemented functionality.

Readiness checked on 2026-10-30: chat exposes the manager MCP tools, but `list_projects` returns `fetch failed`; no listeners are present on ports 8788/8789. Manager `.env` is absent and this shell has no key/model/library-root settings; dependencies and existing database/evidence directories are present. No services were started or runtime project records changed. Credentials outside the manager were not searched. Read-only GitHub connector searches reached both repos with reported pull/push/admin access; this does not configure the independent manager runtime. No Projects operations were found in the current connector catalog. No external writes occurred.

The existing pilot supports assisted tracking from explicitly submitted notes, human-reviewed facts and grounded questions. It does not implement the expanded GitHub coordination, monitoring or QA loop. Current live quality gaps remain below. Historical verification is not a fresh runtime or accuracy result.

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
Start implementation from Stage 1's dependency-ready slices (PM-101 contracts, then durable store/reducer and integrated UI). Consult docs/implementation/README.md for the phase sequence and per-phase browser exit criteria. Do not generate empty runtime modules for later stages or claim a deployed system from the planning artifacts.

Use DEC-008 and the canonical system design for future implementation: state/decision APIs and durable orchestration; GitHub Projects/tickets; independent QA; protected merge/progress; proactive operation. Configure and verify hosting/auth, App identity/rules, owner Projects access, existing board mappings, QA profiles, runner isolation, notification acknowledgement, budgets and backups. Rehearse the complete workflow with real controlled PRs and human-labeled quality evaluation before operational readiness. Restarting the current pilot alone does not fulfill the target.

0. Check service/tool availability for the current session. Review the demo's pending proposals explicitly. Add labeled cases for procedural instructions versus task instances, explicit status evidence and context-aware clarification before changing prompts/contracts.
1. Configure the Anthropic model/key and the dedicated classifier library without a watcher, then run the documented manual live baseline.
2. Compare policies/models using the frozen holdout and explicit budget/settings; retain extra turns only for improved live results without increased unsupported claims.
3. Label and freeze representative sanitized project notes separately before real-world accuracy claims.

## Measurement boundary
The recorded fixture grammar/evidence simulation measures controlled behavior, not LLM accuracy or live embedding relevance. The single live README demo is exploratory; live gates and representative-note accuracy remain unmeasured. Manager-model evaluation caps do not include separate classifier costs. The original pilot and Studio CI fix were published; the MCP source and audit updates are included in the user-authorized 2026-10-28 publication batch.
