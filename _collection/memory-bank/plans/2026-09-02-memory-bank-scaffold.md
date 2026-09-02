# Plan: memory-bank scaffold

Status: done (2026-09-02)

## Goal

Stand up the collection protocol and per-agent banks **before** any product agent code.

## Pieces

1. Root `AGENTS.md` + `CLAUDE.md` (Codex/Cursor/Claude).
2. `.cursor/rules/memory-bank.mdc` and `.claude/rules/memory-bank.md`.
3. `_collection/memory-bank/` with PROTOCOL, progress, decisions, active-context, plans.
4. `_template/` with the same bank shape and placeholder agent files.

## Out of scope

- `ingest-classifier` implementation
- Choosing a runtime for product agents
