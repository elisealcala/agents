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
Status: accepted (design-only scope superseded by DEC-005)
Context: User requested a narrower technical design focused on measurable accuracy rather than stack selection.
Decision: Define five logical modules with inspectable input/output contracts: evidence/project registration, retrieval/read, supported fact extraction, temporal reconciliation and grounded answers/clarification. Measure precision and required-fact recall together, isolate modules with reference inputs, then replay complete project histories. Compare one-pass versus bounded turns empirically. Stack and model choice remain supporting decisions rather than success criteria.
Consequences: Targets are proposed and unmeasured. Annotated source spans, dated state checkpoints, project-held-out evaluation and per-field results are needed before accuracy claims. Empty answers and timeouts cannot improve apparent accuracy. The design-only boundary applied at adoption; DEC-005 authorizes the implemented pilot while preserving these measurement principles.

## DEC-005: Authorized accuracy-first local pilot
Date: 2026-10-05
Status: accepted
Context: The user explicitly requested implementation of the build plan after the prior design-only clarification.
Decision: Implement the five measurable modules with Studio Markdown/project selection, immutable targeted classifier storage, direct snapshot extraction, reviewed versioned state and approved-fact questions. Retain sequential intake/state writes and bounded question turns (six model turns, twelve tool calls, total five retrieved passages). Reuse TypeScript/Node, tRPC, SQLite and Studio; begin live evaluation with the configured Anthropic model, without a hidden model default.
Consequences: DEC-003's design-only boundary is superseded. Candidate facts remain pending until review; conflicts cannot produce definitive current answers; human edits have separate confirmation evidence. Development memory stays separate from runtime data. The 64-document/40-question corpus has five development and three frozen holdout projects; proposals are scored before simulated review, which never repairs omissions. Fixture scores do not justify live accuracy claims. Dedicated classifier library runs without a watcher. Live evaluations are manual and manager cost caps exclude separate classifier calls. Connectors, scheduling, forecasting, assignment and external actions are excluded.

## DEC-006: Local chat MCP bridge delegates to the existing service
Date: 2026-10-07
Status: accepted
Context: User wants this chat connected to the manager, to submit the agents repository and inspect the manager's actual responses.
Decision: Expose local stdio MCP tools as a typed tRPC client of the existing manager service. Keep Studio as a shared review/trace surface; retain explicit project IDs, source versions, human reviews, persisted conversation IDs and asynchronous run inspection. Register the bridge on the local Codex host.
Consequences: Never open a second Store from MCP, so connection startup cannot interrupt active runs. Repository documents and selected chat notes are explicit evidence submissions, not implicit transcript synchronization or a shared development memory bank. Task-only extraction/approved-only answers remain unchanged; arbitrary code knowledge requires a separate capability. Service and dedicated classifier must be running. No credentials enter bridge configuration. Use localhost origins only and return failures visibly.

## DEC-007: Target GitHub planning, QA and delivery coordination for two repositories
Date: 2026-10-30
Status: accepted (product direction; expanded workflow not implemented)
Context: The user clarified that managing repositories means owning the delivery loop for `elisealcala/chore-design` and `elisealcala/agents`, while the user and Codex handle ticket-to-PR coding.
Decision: Target direct manager conversations for status, priorities, blockers and next-step decisions; GitHub Projects and issue authoring; proactive contact about blockers, decisions and new ideas; PR evidence intake and QA with comments/change requests/approval; merging after successful QA; and issue/project progress updates feeding the next work. A QA agent/capability belongs in this workflow, with exact architecture still undecided. See plans/0001-github-delivery-loop.md for requirements and current gaps.
Consequences: This expands the target beyond DEC-005's pilot exclusions for integrations, monitoring and external actions; those exclusions still accurately describe the existing implementation. Existing evidence/review rules remain in force until a specific replacement contract is designed. The manager is the coordinator and the user/Codex own code changes. Runtime GitHub access, background execution, notification delivery, QA execution, review identities and merge conditions need implementation/verification. Requirements acceptance is not evidence that services are running, actions were taken or the new capabilities exist.

## DEC-008: Design durable GitHub coordination with independent QA and version-bound merging
Date: 2026-10-30
Status: accepted (design direction; runtime implementation pending)
Context: The user explicitly requested a system design agent and an orchestrator agent, followed by workflow simulation and repeated adjustment until the proposed project manager covers the required two-repo workflow.
Decision: Use the current manager as one persistent SQLite owner with durable jobs, event inbox and action outbox; a planner proposes scoped tickets/priorities and a deterministic orchestrator controls actions. Add typed GitHub observations and authenticated human decisions alongside unchanged pending-note review. Create/adopt one personal GitHub Project per repo through an owner-authorized Projects adapter; use a distinct repo App identity for reviews and eligible merges. User/Codex own implementation. Independent QA uses disposable VM/microVM execution with a trusted external supervisor and criteria/contribution coverage; bind reports to repo/PR/head/base/criteria/plan/policy/environment/linked items. Require current results and protected conditional merges; update per-ticket progress only from confirmed integrated coverage. Operate on an always-on authenticated host, with public-safe bot coordination-issue mentions plus a durable private Studio inbox and external heartbeat monitoring.
Consequences: Canonical design is docs/github-delivery-system-design.md; R01–R15 traceability/tabletop and simulation limitations are in docs/github-delivery-workflow-validation.md. Retain full provenance, no automatic approval of old note candidates, explicit repo/component isolation, unknown-outcome reconciliation, pause at dispatch and honest non-atomic GitHub edit limits. Partial PRs may merge while tickets stay open. All capabilities have a design path, not implementation proof. Final finite offline model passes 41/41 selected scenarios after notification and partial-completion corrections; it does not validate live permissions, QA semantic quality, real durability or notifications. Real setup, integration/quality gates and implementation remain future work; no GitHub actions or runtime changes occurred in the design task.

## DEC-009: Deployed browser UI is the primary product; implement in eight gated phases
Date: 2026-10-30
Status: accepted (product requirement and implementation plan)
Context: User asked to commit the system design and elaborate a phased technical plan, emphasizing a UI and deployment because they do not want terminal interaction with the manager.
Decision: Reuse Studio's Next.js/React interface for a dedicated authenticated `/manager` web application with same-origin server-side manager access. Keep the manager as the independent single DB owner and MCP as optional tooling. Deliver contracts/state/UI, private hosted access, GitHub connections, conversation/planning/tickets, independent QA, reviews/merge/progress, proactive operation, then a complete production pilot. Deploy private staging in Stage 2 and useful planning by Stage 4; require browser acceptance in every phase. Use docs/implementation/README.md and its eight stage files as the canonical phased technical plan, with proposed runtime paths, ticket-sized slices, dependencies and exit/rollback gates.
Consequences: Daily chat, decisions, evidence review, pause/retry/reconnect and notification acknowledgement must be possible through the website. Initial authorized account setup can use provider/hosting browser consoles; product operation cannot depend on local server commands, MCP setup, JSON or `.env` editing. One-time provider/domain/budget/credentials still need real configuration during implementation. Stage files are planning artifacts, not runtime scaffolds, GitHub issues or deployment proof. Studio/classifier development remains separately owned; no new collection agent is created.

## DEC-010: Local repository references precede GitHub connection
Date: 2026-11-01
Status: accepted
Context: Stage 1 needs durable, explicit scope for the two repositories selected by the user, while GitHub authorization and inventory belong to Stage 3.
Decision: Allow the local manager UI to save only those two repository references using their stable GitHub numeric IDs, verified through GitHub metadata on 2026-11-01. Treat them as local references, not evidence of authorization, a live connection or current work. Notes projects remain independently selected.
Consequences: Stage 3 must verify current repository identity during connection, add authorized discovery and handle renamed or changed metadata. No external GitHub write or automatic repository import occurs when saving a reference.

## DEC-011: Cloudflare-native hosting and durable storage target
Date: 2026-11-01
Status: accepted (hosting direction; migration not implemented)
Context: Stage 2 originally assumed a persistent Linux host. The user selected Cloudflare, then chose Cloudflare-native storage after being told container disks are temporary and the current manager uses local SQLite.
Decision: Target Cloudflare-native hosting and durable storage for Stage 2. Preserve the owner-only browser, single-owner integrity, immutable evidence and verified backup/restore requirements while adapting the implementation. The concrete Cloudflare database and Next.js runtime integration remain subject to compatibility and recovery tests.
Consequences: The original persistent-host topology in DEC-009 is superseded for deployment, not its product or stage gates. Do not deploy the current local SQLite files to ephemeral container storage or claim that a Cloudflare Worker/DO storage adapter exists. Migrate and verify both manager state and evidence before private staging. See docs/implementation/02-cloudflare-native.md.

## DEC-012: Retain automatic cloud backups for 30 days
Date: 2026-11-02
Status: accepted
Context: Stage 2 requires a bounded cloud backup retention policy; the user selected the 30-day option after being told older automatic cloud backups would be deleted.
Decision: Configure 30-day expiry only for the `manager-backups/` prefix in the dedicated private staging backup bucket. Preserve the complete original local SQLite backups separately.
Consequences: Apply and verify the bucket lifecycle rule after R2 is enabled; monitor failures and storage use. Backups older than 30 days may be permanently deleted by the provider. No lifecycle rule or bucket has been created yet.

## DEC-013: Implement Stage 3 onward one small GitHub child ticket per session
Date: 2026-11-02
Status: accepted
Context: The user reports exhausting Codex session tokens before finishing a stage and requested GitHub subtasks targeting 3–4 changed files, then specified starting at Stage 3.
Decision: Keep Stage 3–8 issues #23–#28 as umbrellas and split their remaining planned scope into 74 native child issues (#29–#102), also on the existing implementation Project. Each implementation ticket targets 3–4 source/test files with explicit dependencies, acceptance, focused verification and stopping points. Required component-bank notes are additional. Run one child ticket per fresh session. Separate evidence/acceptance/drill work from implementation fixes.
Consequences: Stages 1–2 are not split by this task; #29 is the entry point after #22 passes. Later work remains gated by the original stage/capability requirements. Proposed file paths adapt to actual implemented boundaries; split follow-ups instead of silently expanding a session. Parent comments and docs/implementation/small-session-backlog.md index the work. Native parent/child links are configured, but blocked-by dependencies are body references. Creating tickets does not establish implementation completion or production readiness.

## DEC-014: Publish verified Stage 2 foundations and split remaining activation/acceptance work
Date: 2026-11-02
Status: accepted
Context: After splitting Stages 3–8, the user explicitly requested committing and pushing completed Stage 2 work and dividing its remainder into small tickets.
Decision: Publish the verified local manager/Studio/evidence Cloudflare foundation, preserving disabled capabilities and distinguishing synthetic controls from hosted acceptance. Keep #22 open as an umbrella with 12 native child issues #103–#114, starting at #103. Each session targets 3–4 source/test/configuration/evidence files plus mandatory component-bank notes; account setup, deployed access and restore drills are separate sessions.
Consequences: DEC-013's initial exclusion of Stage 2 is superseded by this explicit extension. Hosted R2/OAuth/secrets/deployment/cutover/recovery and durable delivery wakeups remain open; backup alarms do not implement delivery scheduling. Original Stage 2 exit gates still block #29. Credentials, actual backups, generated output and unrelated agent/collection edits are not published. Preserve component bank isolation and record publication/check evidence without claiming production readiness.
