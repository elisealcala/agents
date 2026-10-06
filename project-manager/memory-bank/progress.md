# Progress — project-manager

## Status
Current: Authorized accuracy-first local pilot implemented and verified.
Next: Run a manual live baseline, then representative-note evaluation.

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
