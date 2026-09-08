# Progress — _collection

## Status

Current: root README introduces the implemented `ingest-classifier` product before the coding-agent workflow.
Next: product work stays in `ingest-classifier/memory-bank/`.

## Checklist

- [x] Decide: per-agent banks only; `_collection` holds repo progress
- [x] Decide: first product agent is `ingest-classifier` (files + records)
- [x] Root protocol: `AGENTS.md`, `CLAUDE.md`, Cursor rule, Claude rule
- [x] `_collection` memory-bank
- [x] `_template` for new agents
- [x] Root `README.md`
- [x] `ingest-classifier` folder created from `_template`
- [x] Root README updated to present the current product before contributor workflow

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
