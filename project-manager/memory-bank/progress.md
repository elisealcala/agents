# Progress — project-manager

## Status
Current: System design committed locally as `52b7dae`; deployed-web-UI technical plan written in eight stages (DEC-009). Existing runtime remains the offline assisted pilot; new UI/integrations/hosting are not implemented.
Next: Start Stage 1 contracts/persistence/UI slices, then deliver private hosted access in Stage 2. Follow the staged browser acceptance and real integration/quality gates; local startup and existing quality gaps remain open.

## Checklist
- [x] Record system-design proposal and benchmark evidence
- [x] Refocus design on measurable accuracy modules
- [x] Remove unrequested runtime, Studio integration and CI changes
- [x] Agree requirements and authorize implementation
- [x] Implement evidence, review, grounded answers, Studio and evaluation modules
- [x] Verify local pilot and classifier regression behavior
- [ ] Measure live baseline and representative-note accuracy separately
- [x] Capture two-repository GitHub planning/QA/delivery requirements (DEC-007)
- [x] Design expanded delivery system and iteratively simulate workflow (DEC-008)
- [x] Commit system design and define deployed-web-UI implementation stages (DEC-009)
- [ ] Implement and verify the expanded GitHub delivery loop

## Log
### 2026-10-01
- Created project manager with its own TypeScript/tRPC process and SQLite state.
- Intake delegates document storage to classifier, verifies per-note results, and retains pending worker run IDs.
- Analysis makes at most six turns, validates report sources and retains conversation history and traces.
- Added Studio projects workspace, architecture/model research and CI job. Offline tests authored by test-writer; verifier checks pending.

### 2026-10-01 — Verification completed
- Verifier passed manager types/lint/format, 17/17 tests, Studio types/lint/format and Webpack production build. Actual HTTP handler/client smoke passed with fake worker/model.
- Batched fixes included explicit note ID types, stored-note input conflicts, analysis library validation and UI keys.
- Both frozen dependency installs succeeded. Default Turbopack build encountered an environment PostCSS port-binding EPERM; supported Webpack build passed. No live model or classifier run and no browser interaction test performed.
- Evidence and reproduction commands are in docs/verification.md. Live model quality remains pending.

### 2026-10-01 — User scope correction
- User wanted system design, not implementation. Removed the runtime, tests, package/configuration, Studio workspace/dependency/registry, and CI additions from the earlier task. Preserved unrelated existing user changes.
- Retained only the architecture proposal and this bank. Expanded design to cover classifier API gaps, project/document relationships, proposed facts, human clarification and recovery. Earlier implementation/verification entries are historical, not the current state.
- Verifier confirmed design-only contents, no manager runtime/dependency/registry/workspace additions, original Studio runtime/configuration and CI restored, and Studio type/lint/format checks pass. Remaining changes are project-manager design documentation and bank notes only.

### 2026-10-01 — Accuracy-first design refinement
- Replaced the stack-heavy proposal with five modules, each with input/output contracts, accuracy/integrity metrics and provisional acceptance goals.
- Defined supported-fact precision plus required-fact recall, per-field results, abstention handling, temporal correctness and independent deterministic integrity checks.
- Added a proposed reference dataset, project-level holdout, module isolation with reference inputs, full history replay and one-pass versus bounded-turn comparison.
- Independent design review checked denominators, omissions, fact/suggestion separation and source provenance. No code, tests, live model runs or accuracy measurements performed.

### 2026-10-05 — Authorized implementation, phase 1
- User explicitly authorized the accuracy-first build plan, superseding the design-only scope. Added DEC-005.
- Implemented manager contracts, persistence/restart recovery, sequential immutable intake/direct extraction, pending candidates, reviewed versioned state and approved-fact conversations with bounded retrieval.
- Added typed classifier integration, configurable Anthropic adapter with explicit evaluation usage/budget, Studio workspace and frozen synthetic histories with labels/checkpoints/scoring.
- Test-writer authored lifecycle, provider, router, evidence and evaluation coverage; no checks have run during implementation.
- Remaining: complete pre-review proposal scoring, format, delegate verification, record measured control results. Live model/representative-note accuracy remains unmeasured.

### 2026-10-05 — Verification complete
- Verifier passed manager type/lint/format checks and 85/85 tests; classifier checks, 223/223 tests and all four existing offline evaluations; Studio checks and supported Webpack production build.
- Actual HTTP/tRPC and browser flows passed intake/review/grounding, human corrections, project isolation/switching, immutable citation navigation and evaluation failure-to-trace navigation. Temporary servers/tabs were stopped.
- Batched repairs included strict source ID/version/date validation, cleanup preserving original errors, accessible form labels/stable UI keys and explicit missing-date rationales. Final frozen corpus v2 preserves the original semantic expected outcomes/splits and has its own checksum.
- Recorded control replay: 64 documents/40 questions, zero failures; extraction 96/96, pre-review changes 77/77, retrieval 53/53 required spans, answers 120/120 whole cases per policy (40 questions × three repetitions), holdout 45/45 per policy. Fixture results validate controls only.
- Verification evidence is in docs/verification.md and evals/reports/fixture-controls-2026-10-05.json. No live model/representative-note evaluation or publication performed.

### 2026-10-05 — Local manager session
- Started the manager on `127.0.0.1:8788` with a dedicated classifier at `127.0.0.1:8789` and an ignored project-evidence library under `.data/`.
- Reused the existing local Anthropic credentials and explicit model setting without writing another credential file. Manager and worker identity endpoints responded successfully; no live model call was made.

### 2026-10-05 — Atomic commit preparation
- User authorized a new `codex/project-manager` branch, one atomic commit containing the verified pilot and supporting integrations, and a merge into local `main`.
- Pre-commit verifier audit passed; runtime behavior and the recorded measurement boundary are unchanged. Git references record integration outcome; remote publication remains separate.

### 2026-10-07 — Local chat connection
- Inspected the manager's existing tRPC interface: no manager MCP tools existed, and the previous local service was stopped.
- Added a stdio MCP bridge with eleven typed tools delegating to the existing manager service. It shares Studio state and preserves pending reviews, project isolation, immutable citations, conversation IDs and persisted run status.
- Documented local host registration and explicit versioned repository/chat-note submissions. Task extraction remains deliberately scoped; source code/architecture knowledge and automatic chat synchronization are not implemented.
- Test-writer added twenty MCP cases. Verifier passed typecheck, lint, format and all 105 manager tests, including actual HTTP shared-state checks and real stdio discovery/shutdown. Fixture replay had zero failures; frozen lockfile compatibility passed. Initial test helper typing, immediate-terminal run assumptions and stdio working-directory errors were repaired in one batch before re-verification.
- Registered `agents-project-manager` on the local Codex host using Node's direct tsx loader. Started manager port 8788, dedicated evidence server 8789 and Studio 3000 with existing credentials kept outside bridge configuration. Native app UI automation cannot refresh this chat's MCP tool catalog; client reconnection may be needed to expose the newly registered tools.
- Live MCP demo submitted only the public root README at b9fd369, stored/indexed it successfully and read back identical Markdown. Twelve candidates stayed pending; zero review decisions/approved facts. Two questions persisted in one conversation and returned clarification with pending-review warnings. Runtime IDs and actual responses are recorded in docs/chat-demo-2026-10-07.md; raw report remains ignored runtime data.
- The live example revealed unsupported status inference from component existence/procedural instructions, plus an answer-context gap (model asked which repository despite selected project). These remain quality follow-ups, not live accuracy claims. No code commit or push performed for this connection task.

### 2026-10-28 — Memory-bank accuracy audit

- Compared all six decisions with manager orchestration/storage, provider bounds, the service-only MCP bridge and recorded corpus/control report. Core choices are represented; bridge delegates to typed tRPC without opening a second Store, requires project IDs and explicit review, and preserves approved-only answers.
- Corrected accepted DEC-004's obsolete design-only scope, retained its measurement principles, dated the 85-test baseline separately from the later 105-test MCP verification, and removed session-specific tool/server claims from current context.
- Corrected AGENTS/CLAUDE attribution to a nonexistent root two-phase workflow while preserving local delegated verification. Existing MCP source, dependency, README, bank and demo changes were preserved; no approval/review or runtime data was changed.
- The existing corpus/report supports 64 documents/40 questions and zero recorded fixture failures. The README demo's unsupported status proposals and missing project-name context remain documented quality follow-ups; fixture controls do not establish live accuracy.
- Source/history inspection cannot prove every past conversational decision was saved. The current bridge/demo and this audit remain local until committed/published. Fresh verification of this checkout is recorded separately below.

### 2026-10-28 — Audit verification result

- Verifier reran the current checkout: typecheck and lint pass. Formatting fails only on existing Git-ignored `.data/chat-demo-report.json` (missing final newline) and `.data/chat-demo.mjs` formatting; those runtime artifacts were preserved.
- Tests: 97/105 pass; eight MCP HTTP cases fail/time out because the environment rejects temporary `127.0.0.1` listeners with `listen EPERM`. Those eight cases are unverified here; the historical 2026-10-07 105/105 result remains dated historical evidence, not today's result. Test workers exited; no user services were changed.
- Structural documentation validation and `git diff --check` pass. No runtime repair, live model call, approval of facts, commit or push was performed.

### 2026-10-28 — Authorized MCP and audit publication

- User requested committing and pushing the pending checkout. Include the existing eleven-tool MCP bridge, its tests/dependencies, setup README, recorded demo and decision/bank updates alongside the memory audit.
- Preserve ignored `.data` reports, databases, credentials and local service state. Known demo quality gaps and measurement limits remain documented; publication does not approve candidate facts or claim live accuracy.
- No source behavior changed during publication preparation. Final Git references identify the commit and push result.

- Publication verification resolved the listener restriction: verifier reran all 20 MCP tests with local listener permissions and all passed. Together with the 85 non-MCP passes, current coverage is 105/105. Source/config formatting passes across 29 files and whitespace checks pass. Full-package formatting still sees the two ignored runtime demo artifacts; they remain unchanged and outside the commit. No live model calls.

### 2026-10-30 — Two-repository readiness check

- User wants help managing two repositories and asks whether the agent is ready to run them. Repository identities and desired responsibilities were requested; no expanded execution design was selected.
- Current MCP `list_projects` returns `fetch failed`; no listeners were found on ports 8788/8789. The manager has no `.env`, and this shell has no Anthropic key, manager model or dedicated library-root settings. Existing dependencies, manager database and evidence directory are present. Credentials elsewhere were not searched and persisted projects could not be listed through the service.
- Reviewed current README, service/router and recorded live demo. Implemented scope is explicit Markdown evidence intake, pending human review, approved task facts and grounded questions. Automatic repository synchronization, scheduling, assignment and external/code actions are absent. Starting services alone would not provide autonomous repository management.
- The live README demo's unsupported status proposals and missing project-name context remain documented; representative live accuracy is unmeasured. Historical tests were not rerun for this source/runtime inspection. No services started, model calls made, project records changed or facts approved. Updated only this agent's development bank; preserved unrelated checkout changes.

### 2026-10-30 — GitHub delivery responsibilities clarified

- User identified `elisealcala/chore-design` and `elisealcala/agents`. Wants direct manager conversations for status/next steps/priorities/blockers, proactive contact for blockers and new ideas, GitHub Projects and ticket descriptions, PR evidence intake, QA testing/reviews/change requests/approval, merging, and ongoing progress/backlog maintenance. The user/Codex own implementation from ticket to PR.
- Captured requirements and missing capabilities in plans/0001-github-delivery-loop.md and accepted DEC-007 as product direction. QA may be an internal agent; exact architecture remains undecided. Existing pilot capability and live-accuracy limits are unchanged.
- Read-only GitHub connector searches found both repos with pull/push/admin permissions in this session. Those permissions are not manager-process configuration. Issue/review/merge tools are available to this chat; no Projects tools were found in the current connector catalog. No GitHub writes, reviews, merges, service startup or code implementation occurred.
- Updated only the manager bank and checked whitespace. Runtime tests were unnecessary for requirements-only changes; unrelated checkout edits were preserved.

### 2026-10-30 — System design, orchestration and iterative workflow simulation

- User explicitly requested system-design and orchestrator agents for the GitHub integration and QA workflow, iterative simulation/adjustment, and a clear final system design. Delegated two independent draft contributions, then synthesized docs/github-delivery-system-design.md and docs/github-delivery-workflow-validation.md with canonical R01–R15 requirements and a 16-step two-repo tabletop.
- Verified primary GitHub documentation for personal Projects authentication/GraphQL operations, distinct reviewer identity, conditional head merge, strict branch checks/expected status sources, privileged PR-execution risk and webhook reconciliation. These informed explicit activation gates; no connected-chat permission was treated as manager-runtime access.
- Chose durable single-owner orchestration, typed observed/human/proposal lanes, independent VM/microVM QA, contribution/whole-ticket completion separation, protected current-version merge, meaningful private/public-safe notification handling and external host health monitoring. Added DEC-008. Existing independent service/bank boundaries and pending note-fact review remain intact.
- Created an offline executable design model and JSON trace report in docs/simulations/. The first incomplete strawman/tabletop exposed missing planning, freshness, recovery and attention guards. Independent review then found the model hid repeated notification sends behind a unique-record count; corrected actual delivery-attempt checks and retry/ack/dedup scenario. A second review found PR contribution readiness conflated with whole-ticket completion; split them and added partial/final contribution scenarios. Extended fingerprint invalidation across repo/PR/head/base/criteria/plan/policy/environment/linked issues.
- Final model replay: 41/41 selected revised scenarios versus 9/41 for the intentionally incomplete strawman. These are finite proposed-design consistency results only, with fake remote effects and in-memory restart modeling; not actual GitHub, disk durability, QA/model accuracy, alert delivery or bank-isolation execution evidence. R15 is design/tabletop-only.
- No runtime source changes, model calls, GitHub writes/reviews/merges, services, credentials, notifications or commits were made. Preserved unrelated collection/career-assistant changes. Final artifact verification follows below.

- Artifact verifier found an additional model counterexample: user inbox acknowledgement during failed external delivery did not suppress a later send. Fixed the acknowledgement guard and added that scenario. Final replay now has 41/41 revised cases (9/41 incomplete strawman); earlier 40-case results were intermediate. Verification rerun requested.

### 2026-10-30 — Final design artifact verification

- Verifier reran the offline model: 41/41 revised scenarios pass and saved JSON matches fresh replay exactly. Python syntax, whitespace, Markdown local links, R01–R15 register and final counts pass. The acknowledgement-before-delivery counterexample and partial-PR completion scenarios pass. No material design contradictions found.
- Added README links to the canonical design and workflow validation. Production TypeScript/lint/test/build and real integration checks were not run for this documentation/design-model task. No operational readiness or live semantic accuracy is claimed. Manager memory-bank update is complete; no unrelated banks were read or changed by this task.

### 2026-10-30 — Authorized design commit

- User requested committing the system design, then a phased technical implementation plan with a deployed web UI and no routine terminal interaction. Commit the manager design, validation/model artifacts, requirements and corresponding development-bank updates as one local documentation commit; unrelated collection/career-assistant changes remain outside it. Git history records the commit result; remote push was not requested.

### 2026-10-30 — Deployed UI technical implementation plan

- Committed the reviewed system design and validation/model/bank artifacts locally on `main`: `52b7dae` (`docs: design GitHub project delivery and QA workflow`), 11 scoped manager files. Unrelated collection/career-assistant work remained outside the commit; no push.
- Inspected the existing Studio manager components/routes/client and manager package/server contracts without reading any other component's memory bank. Studio already provides a local Next.js/React/tRPC manager UI, but its browser client takes a direct agent URL and the server is localhost-only/unauthenticated. The plan makes authenticated same-origin server access and explicit hosted networking early work.
- Added docs/implementation/README.md and eight stage files covering contracts/state/UI; hosted access; GitHub connections/sync/Projects; conversations/planning/tickets; isolated QA; reviews/merge/progress; proactive browser operation; and full production pilot. Every phase includes proposed files, ticket-sized planning IDs, dependencies, browser journeys, checks, exit and rollback. Added bank pointer plan 0002 and DEC-009; linked from README/canonical design.
- Primary user requirement is a deployed website with no terminal dependency for daily operation. Hosting/auth arrives in Stage 2 rather than after all integrations; Stage 4 is a useful planning release. Provider/domain/budget and real secrets remain implementation inputs. Checked primary Next.js self-hosting and Auth.js session/route guidance; no packages installed or hosting provider selected.
- No runtime source/empty scaffolds, GitHub tickets, infrastructure, services, credentials or external writes were created. The staged plan is a second local documentation change pending artifact verification/commit; preserved unrelated checkout changes.

- Verifier checked eight stages, 12 documents and 38 local links/anchors; source/path claims and component boundaries match current code. Addressed two findings: hosted setup/health must survive missing provider configuration despite current bootstrap throwing before HTTP; Stage 6 merge exercises are controlled staging/pilot only, with unattended production dispatch gated on Stage 7 attention/operations and Stage 8 quality acceptance. No runtime tests were necessary for the documentation-only plan.

- Final verifier recheck passes: 12 documents, 38 local links/anchors, all eight phase structures and whitespace; both findings resolved and no material contradictions remain. Save the staged technical plan and its scoped README/design/bank updates as a second local documentation commit; Git history identifies it. No remote publication or application implementation is included.

### 2026-10-30 — GitHub implementation project

- User requested one GitHub project and an issue per implementation stage. Created private Project Manager — Implementation at https://github.com/users/elisealcala/projects/3 and eight open `elisealcala/agents` issues #21–#28, one for each stage, with scope, acceptance and dependencies. Verified all eight appear on the project, currently Todo; dependencies are described in issue bodies, not GitHub dependency fields.
- GitHub connector issue creation returned 403 and the local GitHub CLI authentication was invalid; used the signed-in browser to create and attach the project/issues. No implementation work or push occurred. Full detailed stage documents remain local at commit e2493d0 and are not yet available remotely; issue bodies contain standalone summaries.

### 2026-11-01 — Stage 1 started

- Began issue #21 with initial delivery schemas for repository and work identities, provenance lanes, capability state, QA fingerprints, work, decisions, observations, jobs, outbox intents, QA reports and notifications. These are groundwork only: no router, migration, executor or UI is implemented by this slice.
- The existing eight stage issues remain open; complete and verify the full acceptance criteria before closing #21 or starting dependent stages. Existing unrelated working-tree changes remain preserved.
- Verification: manager typecheck and lint pass; four focused schema tests pass. The QA report schema is only a summary and cannot authorize a pass or merge without criterion coverage, evidence and independent verification. Job and outbox shapes do not implement lease fencing.

### 2026-11-01 — Stage 1 foundation continued

- Added transactional versioned delivery migrations, repository-scoped observations, optimistic transitions and atomic outbox intents, leased jobs and outbox fencing, explicit unknown-outcome recovery, and fake-adapter executors. A GitHub observation alone cannot mark work delivered. Existing reviewed facts and note data are preserved; delivery actions are not exposed for remote dispatch.
- Added read-only delivery queries and an initial Studio manager shell, with labelled unconnected repository scopes and access to the existing review and evidence workspace. Browser testing used an isolated synthetic database; it showed a reviewed human confirmation and exact source passage. The mobile evidence view was adjusted to stack panels.
- Documented backup and rollback requirements. The ownership lock coordinates upgraded processes using the same path; older binaries do not honor it and must be stopped before migration. Version-1-to-2 upgrade and legacy data are covered in tests.
- Remaining before #21 completion: integrate the job/outbox execution lifecycle safely with service startup, complete the real repository binding and durable delivery model, and finish comprehensive acceptance verification. Stage 1 is not closed or committed.
- Verification during this slice: the full manager suite passed 119/119 before the final contribution-contract addition; manager typecheck/lint and Studio checks passed. The Studio Webpack production build passed with the existing font network access. Subsequent focused contract tests also passed. Browser checks covered an isolated saved repository selection across refresh, offline state, desktop and narrow layouts, and a synthetic approved fact with its exact human-confirmation source. The service now periodically recovers expired attempts to unknown/reconciling; it does not dispatch GitHub actions.

### 2026-11-01 — Stage 1 execution and local references

- Wired an adapter-gated delivery scheduler into startup/shutdown; it drains active work, fences attempts, respects paused repositories and revisions, and recovers expired jobs/outbox intents without blindly retrying unknown effects. No external adapter is registered in this phase. Timeout requests cooperative cancellation and leaves outcomes for reconciliation; future real adapters must honor cancellation or be isolated.
- Verified the two selected repository numeric IDs with GitHub metadata and added explicit local reference controls (DEC-010). Saving them does not connect GitHub or import work. Notes projects are visibly independent of repository scope.
- Browser checks used isolated data to save both references, select scopes, refresh, exercise desktop/mobile keyboard navigation, and inspect existing synthetic approved evidence. See the previous entry for migration/rollback and mobile coverage. Final verifier checks and publication are pending.
- Final verification: manager typecheck and lint pass, all 132 manager tests pass; Studio typecheck, lint, format and Webpack production build pass. The scheduler suite passed ten consecutive focused runs. Browser acceptance used isolated data; no real GitHub mutations or model calls were made. Record Stage 1 in one scoped commit; its hash and GitHub issue state identify publication.
