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
