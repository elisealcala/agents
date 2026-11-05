# Decisions — _collection

## DEC-001: Per-agent memory banks only

Date: 2026-09-02
Status: accepted
Context: Agents in this collection will use different architectures. A shared bank would mix unrelated context and confuse coding agents.
Decision: Each agent owns `memory-bank/`. Root files are protocol only, never memory.
Consequences: Repo-level protocol/template work needs an owner agent (`_collection`).

## DEC-002: `_collection` is the repo agent

Date: 2026-09-02
Status: accepted
Context: There is no shared bank, but this repo still needs a place to track protocol and scaffolding.
Decision: `_collection` is not a product agent. Its bank records collection layout, rules, and `_template` work only.
Consequences: Do not put ingest-classifier design details here beyond "it is the next product agent".

## DEC-003: First product agent is `ingest-classifier`

Date: 2026-09-02
Status: accepted
Context: First runnable agent should classify ETL intake: files/documents and rows/records.
Decision: Name it `ingest-classifier`. Scaffold the memory-bank process before any classifier code.
Consequences: Create that folder from `_template` in a later slice; use **its** bank for product work.

## DEC-004: Rules for Cursor, Claude, and Codex

Date: 2026-09-02
Status: accepted
Context: Any coding agent must follow the same loop.
Decision: Root `AGENTS.md` (Codex + others), `CLAUDE.md` + `.claude/rules/` (Claude Code), `.cursor/rules/memory-bank.mdc` (Cursor). Repeat the loop in each `memory-bank/PROTOCOL.md`.
Consequences: If the protocol changes, update root files **and** `_template/memory-bank/PROTOCOL.md` (and existing agents' PROTOCOL.md).

## DEC-005: Heterogeneous runtimes

Date: 2026-09-02
Status: accepted
Context: The collection exists to try different agent architectures.
Decision: Shared process only (memory bank + rules). Each agent brings its own stack.
Consequences: `_template` must not assume LangGraph, Cursor SDK, or Python. Product agents choose a runtime when they are created.

## DEC-006: Product-first root README

Date: 2026-09-08
Status: accepted
Context: The root README led with the coding-agent workflow and retained a stale statement that classification had not started, while the product documentation described classification and retrieval.
Decision: Introduce the current product and its visitor-facing capabilities before documenting the collection layout and memory-bank workflow.
Consequences: Visitors can understand what the repository does immediately; repo-maintainer instructions remain available later in the same README.

## DEC-007: Agent READMEs include examples and evidence

Date: 2026-09-08
Status: accepted
Context: Each agent needs a concrete way for visitors to understand its behavior and inspect demonstrated results.
Decision: The stack-neutral README template includes setup, a reproducible input/run/output example, and at least one of a recorded demo or evaluation results. Evidence includes a date and revision; evaluation results also include a reproduction command, dataset, metrics, and limitations.
Consequences: New agents replace placeholders with actual observed output and linked evidence before being presented as ready to use. Template text must not imply an evaluation has already run. Existing agents remain responsible for their own documentation and memory banks.

## DEC-008: Optional TypeScript preset and responsibility-based layout

Date: 2026-09-08
Status: accepted (lint/format split superseded by DEC-011)
Context: New agents need a consistent source layout and ready-to-use quality tools without imposing a language on the collection.
Decision: Keep the general template language-neutral and ship a self-contained TypeScript preset. Group source by responsibility, colocate tests, and place evaluation runners/fixtures in evals/. Use ESLint for code rules, Biome only for formatting, and TypeScript 6.0 for compatible type checks. Every TypeScript agent owns its dependencies and lockfile; GitHub Actions verifies the existing product and an assembled starter separately.
Consequences: New agents can opt into the preset, replace its package name, and remove copied presets. Adding a product also requires adding its own CI job. The collection has no root runtime package or shared product memory.

## DEC-009: Register authorized project-manager pilot
Date: 2026-10-05
Status: accepted
Context: User explicitly authorized project-manager implementation after the design-only scope correction.
Decision: Register its independent quality/test/control-evaluation CI job and link its setup from the collection README.
Consequences: Keep its architecture, measurement and runtime details in project-manager's own memory bank. Preserve existing classifier, Studio and starter jobs.

## DEC-010: Atomic project-manager integration
Date: 2026-10-05
Status: accepted
Context: User requested a new project-manager branch, an atomic commit and a merge into main.
Decision: Use `codex/project-manager` with one feature commit; fast-forward local `main` to preserve that single-commit integration.
Consequences: Keep the branch reference. Remote publication requires its own authorization.

## DEC-011: TypeScript preset uses Biome for lint and formatting

Date: 2026-10-28
Status: accepted
Context: The memory audit found that DEC-008 still described ESLint, although commit `0ba86c7` (2026-09-28) already changed the optional preset to Biome. This entry records the existing implementation, not a new tooling migration.
Decision: The optional TypeScript preset uses Biome for lint and formatting, with warnings failing the lint gate, and `tsc --noEmit` for types. Preserve independent package configuration, responsibility folders and the assembled-starter CI job from DEC-008.
Consequences: DEC-008's ESLint/Biome split is superseded. Product tooling decisions remain in owning banks; no root runtime or shared product memory is introduced.

## DEC-012: Personal usefulness guides the next collection priority

Date: 2026-10-29
Status: accepted
Context: The user reports low engagement with this personal agent repository and uncertainty about which of several ideas to pursue. Asked what would make it useful over the next two weeks, they chose an agent used for a real personal task.
Decision: Evaluate the next collection priority by whether it produces a useful result for the user's own task. This criterion is user-confirmed; no particular agent, feature or roadmap has been selected.
Consequences: Propose a bounded personal-use experiment before committing to product implementation. Keep agent-specific design and progress in the owning bank once a direction is selected.

## DEC-013: Prioritize job and freelance search

Date: 2026-10-29
Status: accepted
Context: After discussing possible personal-use agents, the user explicitly asked to prioritize job and freelance search too.
Decision: Include both employment and freelance opportunities as an explicit near-term collection priority. The user subsequently confirmed a mix of their current specialty and AI-focused work as the target, and remote work they can do from Peru now as the initial location constraint. Their relative emphasis and ordering against other personal goals remain unspecified.
Consequences: Frame the next experiment around a useful career-search result covering both kinds of opportunity. This selects a problem area, not a product architecture or authorization to implement a new agent. Detailed product work must use an owning bank.

## DEC-014: Register the user-selected career assistant

Date: 2026-10-30
Status: accepted
Context: The user explicitly returned to the small career-assistant idea as a way to reengage with this personal agent repository.
Decision: Register `career-assistant/` as the next independent agent, scaffolded from the language-neutral template with its own memory bank. This records the selected direction without choosing a runtime or claiming a working implementation.
Consequences: Further career-assistant design and progress belong in its owning bank. Existing agents and their runtimes remain independent; collection records track registration only.
