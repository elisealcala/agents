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
Status: accepted
Context: New agents need a consistent source layout and ready-to-use quality tools without imposing a language on the collection.
Decision: Keep the general template language-neutral and ship a self-contained TypeScript preset. Group source by responsibility, colocate tests, and place evaluation runners/fixtures in evals/. Use ESLint for code rules, Biome only for formatting, and TypeScript 6.0 for compatible type checks. Every TypeScript agent owns its dependencies and lockfile; GitHub Actions verifies the existing product and an assembled starter separately.
Consequences: New agents can opt into the preset, replace its package name, and remove copied presets. Adding a product also requires adding its own CI job. The collection has no root runtime package or shared product memory.
