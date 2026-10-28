# Progress — project-manager

## Status
Current: Local pilot and chat MCP bridge implemented; source/memory audit refreshed on 2026-10-28. User authorized publication of the MCP work and audit on 2026-10-28.
Next: Address labeled demo quality gaps, then measure the manual live baseline and representative-note accuracy.

## Checklist
- [x] Record system-design proposal and benchmark evidence
- [x] Refocus design on measurable accuracy modules
- [x] Remove unrequested runtime, Studio integration and CI changes
- [x] Agree requirements and authorize implementation
- [x] Implement evidence, review, grounded answers, Studio and evaluation modules
- [x] Verify local pilot and classifier regression behavior
- [ ] Measure live baseline and representative-note accuracy separately

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
