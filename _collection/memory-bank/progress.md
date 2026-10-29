# Progress — _collection

## Status

Current: Collection memory/protocol audited against the local checkout on 2026-10-28. All registered folders have the required bank files; product audit details stay in owning banks.
Next: Continue product work in owning banks; use Git branch references to verify publication status.

## Checklist

- [x] Decide: per-agent banks only; `_collection` holds repo progress
- [x] Decide: first product agent is `ingest-classifier` (files + records)
- [x] Root protocol: `AGENTS.md`, `CLAUDE.md`, Cursor rule, Claude rule
- [x] `_collection` memory-bank
- [x] `_template` for new agents
- [x] Root `README.md`
- [x] `ingest-classifier` folder created from `_template`
- [x] Root README updated to present the current product before contributor workflow
- [x] Add repository description and relevant GitHub topics
- [x] Add example input/output and demo or evaluation evidence to the agent README template

- [x] Document and implement project structure and quality tooling
- [x] Verify project structure and quality tooling
- [x] `studio` exists as a local Next.js app; its design stays in `studio/memory-bank/`

## Log

### 2026-09-02

- Locked layout: no shared bank; Cursor + Claude + Codex rules at root and on each bank.
- Scaffolded root `AGENTS.md` / `CLAUDE.md`, `.cursor/rules/memory-bank.mdc`, `.claude/rules/memory-bank.md`.
- Created `_collection` bank (`PROTOCOL.md`, `progress.md`, `decisions.md`, `active-context.md`, `plans/`).
- Created `_template` for copying into new agents.
- Did **not** add `ingest-classifier` code in this slice.
- Added root `README.md` (collection layout, bank usage, how to add an agent).
- Repo is on GitHub: https://github.com/elisealcala/agents
- Copied `_template/` → `ingest-classifier/`. Further product work uses that agent's bank.
- ingest-classifier first slice (model picker) is done. Classification is not started.

### 2026-09-03

- ingest-classifier now has GitHub milestones/issues. Product detail stays in that agent's bank, not here.

### 2026-09-08

- Reworked the root README so a visitor first sees what `ingest-classifier` does, its major capabilities, quick-start commands, and the link to product documentation.
- Removed the stale statement that classification had not started.
- Kept detailed product history in `ingest-classifier/memory-bank/`; this collection bank records only the repo-level documentation change.
- Added `DEC-006` for the product-first root README structure.

### 2026-09-08 — Repository metadata and agent presentation template

- Added a short collection description to the root README and GitHub About metadata.
- Set GitHub topics to `ai-agents`, `llm`, `document-processing`, `text-classification`, `semantic-search`, and `rag`.
- Expanded `_template/README.md` with setup, reproducible input/run/output, recorded demo, and evaluation result placeholders. Agents must supply at least a demo or evaluation results; no results were invented.
- Updated the root onboarding checklist to require completing the example and evidence sections and changed its copy example to a fresh agent name.
- Added `DEC-007` for the agent README evidence convention.
- Remaining: new agents fill these sections with their own actual evidence; existing product documentation remains owned by each product agent.

### 2026-09-08 — Project structure and quality tooling

- Documented responsibility folders, colocated tests, and separate evaluation runners.
- Added a minimal TypeScript CLI, smoke test, local ESLint/Biome/tsc commands, and a lockfile.
- Added separate GitHub Actions jobs for the existing agent and a newly assembled TypeScript starter.
- Added `DEC-008`. Verification is pending; existing documentation edits are preserved.

- Verification completed: the preset and a renamed, independently assembled agent pass frozen installs, typecheck, ESLint, Biome, and the CLI smoke test. Deliberate type/lint/format violations are detected. Workflow configuration and documentation links pass inspection; GitHub execution awaits a push.

### 2026-09-08 — Publication

- User authorized committing and pushing the verified repository, template, and agent changes to GitHub `main`.
- Confirmed local `main` and `origin/main` were synchronized before preparing the commit; unrelated `.cursor/plans/` files are excluded.
- Local checks remain green from the completed verification batch. The new GitHub Actions workflow will report its remote result after publication.

### 2026-10-01 — studio

- `studio/` exists. It is a local Next.js app. Its design and progress stay in `studio/memory-bank/`.
- GitHub Actions gains a `studio` job (`pnpm check`, `pnpm build`) beside the classifier job.

### 2026-10-01 — project-manager

- Registered `project-manager/` from `_template`. Product work uses its own bank.

### 2026-10-01 — Scope correction
- `project-manager/` is a design-only scaffold. Its unrequested runtime and CI registration were removed after user clarification. Product design stays in its own bank.

### 2026-10-01 — Publication
- User authorized committing and pushing remaining local work to GitHub `main`.

### 2026-10-05 — Authorized project-manager registration
- User explicitly authorized implementing `project-manager/`; its product details remain in its own bank.
- Added its independent CI job and updated the collection README. Existing classifier, Studio and template CI jobs remain.
- Verification pending; no publication requested in this task.

### 2026-10-05 — Verification complete
- Registered packages pass their verifier checks. The project-manager job has an independent lockfile/test/control-evaluation path; original classifier evaluations and Studio/template jobs are preserved.
- Product measurement details remain in owning banks. No commit/push requested or performed.

### 2026-10-05 — Atomic integration authorized
- User requested the verified project-manager work as one atomic commit on a new branch, then integration into `main`.
- Created `codex/project-manager` from synchronized local `main`. Pre-commit verifier audit passed scope, whitespace, formatting and commit-candidate checks; existing full verification remains applicable.
- Integration uses a single feature commit and a fast-forward of local `main`, keeping the feature branch as a reference. No remote push is requested.

### 2026-10-05 — Project-manager publication
- User authorized pushing the integrated work. Published `7e5a940` to `origin/main` and created `origin/codex/project-manager` in one atomic push.
- Both local branches track their corresponding remote branches. The project-manager implementation remains one atomic feature commit.
- Publication bookkeeping was refreshed locally after the push.

### 2026-10-07 — Publication bookkeeping cleanup
- Reviewed the two pending collection memory-bank files: both contain completed publication bookkeeping, with no pending code changes.
- Refreshed the current context to include the published Studio CI correction at 2b1b45d. Commit these notes separately from the published implementation commits.
- Documentation-only change; runtime verification is unchanged.

### 2026-10-28 — Memory-bank accuracy audit

- Checked collection protocol/rule pointers, required bank-file presence, tracked files, template commands, CI registration and Git history. All four CI jobs remain registered. Existing publication bookkeeping is already committed at `b9fd369`.
- Backfilled the preset's existing Biome choice as DEC-011 and marked the affected portion of DEC-008 superseded. Corrected the root README's outdated multi-provider claim against the current provider configuration.
- Product audits and corrections were recorded separately in owning banks; no product memory was copied into this bank and no bank was merged. Template placeholders remain intentional.
- At audit start all 25 existing bank files were tracked. Local HEAD and cached `origin/main` matched; no remote freshness or backup claim is made. Existing uncommitted work was preserved. No commit/push or runtime change.
- Limits: repository evidence cannot establish completeness of past conversational decisions. Static decision/file checks and whitespace verification are used for this documentation task; no new architectural behavior is authorized.

- Final structural validation passes: all required bank files exist; 50 non-template decisions plus the intentional template placeholder have unique IDs and complete fields, and inspected source decision references resolve. Package verification outcomes are recorded only in their owning banks.

### 2026-10-28 — Authorized publication

- User explicitly requested committing and pushing the pending checkout, including the audit and previously local work. Fetched `origin` and confirmed local `main` matches remote `main` before preparing publication.
- Prepared the reviewed source, documentation and separate memory-bank updates for one commit and a normal push to `origin/main`. Ignored runtime data remains excluded; no history rewrite or unrelated cleanup is included.
- Package verification and product publication scope remain documented in owning banks. Git commit/branch references provide the resulting publication identity.

### 2026-10-29 — Repository cleanup

- Reviewed the pending working-tree changes and removed out-of-scope draft documentation at the user's request. No application source changes remained.
- Refreshed collection context; validated the documentation diff and working-tree scope before publication.
