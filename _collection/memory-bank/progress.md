# Progress — _collection

## Status

Current: The user selected a small career assistant as the next collection focus on 2026-10-30. Registered `career-assistant/` from the language-neutral template; product work belongs in its own memory bank.
Next: Continue the selected work in `career-assistant/memory-bank/`. Existing agents remain independent.

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
- [x] `career-assistant` registered; its scope and progress stay in its own bank

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

### 2026-10-29 — Personal repository direction discussion

- The user asked whether the existing project manager can help give this personal agent collection direction, reporting many ideas but no clear next step.
- Reviewed collection records and public agent READMEs without reading or combining product memory banks. Asked which near-term outcome matters and what ideas are competing for attention.
- Attempted the manager's project-list tool; it returned `fetch failed`. No service was listening on the documented manager/evidence ports during this check, and the manager's local environment configuration was absent. No manager project, source note, review or approved fact was created.
- Proposed using a small real personal workflow to guide the next choice; this remains a recommendation awaiting the user's preferences, not an accepted roadmap or architectural decision. No application source, runtime configuration or product-bank changes.

### 2026-10-29 — Personal usefulness confirmed

- The user selected an agent used for a real personal task as the desired outcome over the next two weeks.
- Their competing interests are improving AI skills, finding a job or freelance work, organizing personal mortgage/housing files, planning a move to Spain, and improving mobility.
- Recorded DEC-012 for the collection's near-term selection criterion. A career-opportunity review experiment is a recommendation connecting several stated interests, not a selected product or approved implementation. Timing and urgency of the move versus career needs remain unknown.
- The manager connection was not changed or retried during this follow-up. No product bank was read or changed, and no runtime work was performed.

### 2026-10-29 — Job and freelance search prioritized

- The user explicitly asked to prioritize job/freelance search. Recorded DEC-013 and refreshed collection status so this is a confirmed priority rather than only an assistant recommendation.
- Both forms of work are included; the user has not specified their relative emphasis or priority compared with the Spain move. No product architecture or new implementation was inferred.
- The proposed first useful result remains a small opportunity comparison with evidence and a next action. Collection records only were changed; no project-manager facts were submitted or approved, and no runtime or product-bank changes were made.

### 2026-10-29 — Mixed career target confirmed

- The user answered "a mix" when asked whether to target their current specialty, AI-focused work, or both. Clarified DEC-013 and the current context accordingly; specific role titles and relative weighting remain open.
- A professional profile is the next input for a practical opportunity-comparison trial. No live opportunity search, product implementation, manager submission or approval occurred. Updated collection records only.

### 2026-10-29 — Résumé supplied for the first career trial

- The user supplied a two-page résumé in response to the professional-profile request. Reviewed both rendered pages; drafted a source-grounded opportunity profile in chat and distinguished reported experience from proposed search directions.
- Asked whether the initial shortlist should cover remote work from Peru, Spain-based opportunities or both. Location and work eligibility remain unconfirmed; no live listings have been selected.
- Kept the résumé, contact details and detailed career profile outside tracked collection records. No product agent was created, no product bank was accessed, and no project-manager source or approved fact was created.

### 2026-10-29 — Peru remote scope and first live comparison

- The user selected remote work they can do from Peru now. Clarified DEC-013 and removed the pending location question from current context.
- Researched current employer listings and compared candidate roles against the résumé-based profile. Direct rendered pages exposed both expired indexed postings and eligibility caveats absent from search snippets; conditional leads are not confirmed Peru-eligible openings.
- Reported a small comparison in chat, separating relevant experience, unestablished requirements and next actions. No applications, messages, accounts, project-manager submissions or fact approvals were performed. No code or product-bank changes.

### 2026-10-29 — Application evidence check

- The user supplied application questions asking for large/high-frequency dashboard performance and event-driven, idempotent ingestion experience. Assessed these against the previously reviewed résumé and relevant public project documentation/source without accessing product banks.
- Distinguished related frontend/data-consistency experience and a repository idempotency example from evidence of the user's personal contribution, measured dashboard scale, or professional message-broker experience. Exact examples remain unconfirmed; missing résumé evidence is not proof of no experience.
- This lowers confidence in the earlier role fit assessment until direct examples are established. No application answers were fabricated or submitted, and no product changes were made.

### 2026-10-29 — Clarified actual repository contribution

- The user asked how the agents repository is helping the job search. Clarified that current research and matching were chat work; collection notes alone do not constitute a working career agent or manager-backed workflow.
- Acknowledged drift from the original objective of making the personal agent repository useful. Existing manager use for reviewed application tasks is a possible small next experiment; no implementation or prioritization engine was claimed.
- Refreshed collection status only. No product code, manager state, product bank, application or employer communication changed.

### 2026-10-30 — career-assistant registration

- The user explicitly returned to the small career-assistant idea as a way to reengage with this repository. Registered `career-assistant/` from `_template` and replaced its agent-name placeholders; the optional runtime preset was not selected.
- Added DEC-014 for collection registration. Further product scope, design and progress use `career-assistant/memory-bank/` only. Existing agents and their banks remain unchanged.
- No runtime implementation, model configuration, CI job, commit or publication is included in this registration.

### 2026-11-03 — External learning documentation

- At the user's request, researched the collection's public source/docs alongside two independent repositories and created an Obsidian learning library at `/Users/elizabethalcala/Sites/obsidian/knowledge/personal-projects/`. `START-HERE.md` is the entry point.
- The external library contains 25 notes and 11 canvases covering frontend, backend/local tooling and DevOps, with source references, ticket explanations, vocabulary and exercises. Product-specific evidence and implementation details remain in the external learning material and owning sources, not this collection bank.
- Checked all internal links, Canvas structure/node and edge references, embedded note targets, card nonoverlap, local source-link paths/line bounds, and saved-file byte equality. Previewed the overview and a backend canvas in Obsidian; refined diagram spacing afterward. This was documentation research, not a new application test/deployment/acceptance run.
- Preserved existing working-tree edits. No product source, product bank, GitHub issue, commit or deployment was changed by this task. Collection learning bookkeeping only was appended here and to active context; no architecture decision was introduced.

### 2026-11-04 — External guide extension and refresh skill

- At the user's explicit request, delegated Coding Harness documentation and reusable skill creation to separate agents, with an independent fixture trial of the completed refresh workflow.
- Located the existing guide in the reorganized `obsidian/work/personal-projects` vault. Added four learning notes and three canvases for the fourth repository, updated shared navigation/concepts, and added refresh instructions. The guide now has 30 notes and 14 canvases. Product-specific findings stay in the external guide and its owning sources.
- Installed the user-level skill at `/Users/elizabethalcala/.codex/skills/refresh-project-learning/`. Its helpers detect source drift, validate the guide and checkpoint only reviewed/resolved content; semantic edits remain an agent responsibility. Missing sources and unresolved claims remain explicit, and personal annotations/layouts are preserved. No shared product memory bank is introduced.
- Validation passed for the installed guide's links/Canvas structure and checked local source references. The bundled skill validator and seven isolated behavior tests passed. An independent four-project fixture refresh corrected stale explanations/diagram text, preserved personal annotations and Canvas layout, checkpointed reviewed results and left fixture sources clean. Fixed the temporary-path mismatch it exposed and verified the documented report location afterward.
- Source repositories, product banks, issue states and deployments were unchanged. No application/model run, worktree, publication or commit/push was performed. Existing collection edits were preserved; refreshed this external-documentation pointer only. Older guide evidence dates remain intact until actual review by the skill.

### 2026-11-04 — Publish pending collection work to main

- The user asked to review local `main` and to commit and push. A fetch showed local `main` nine commits behind `origin/main`. Local project-manager files were older copies of content merged in PRs #115–#119. The #108 boundary notes belong to the unmerged `codex/issue-108-private-boundary` branch, so main kept the upstream project-manager versions and no product bank was rewritten.
- Fast-forwarded to `origin/main`, then committed the collection bank records (DEC-012–DEC-014 and logs) and the `career-assistant/` design scaffold. Checked the scaffold for personal data: it has synthetic examples only. Docs only; no code, so no typecheck or tests ran. The full pre-sync working tree is kept in the stash "pre-sync backup 2026-11-04 (local main work)".
