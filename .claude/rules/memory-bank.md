---
description: Per-agent memory bank protocol for this collection (Claude Code)
---

# Memory bank

This repo is a collection of agents. Each agent owns `memory-bank/`. There is no shared bank.

- Collection, protocol, rules, or `_template` → `_collection/memory-bank/`
- Work in an agent folder → `<agent>/memory-bank/`

Before work: read that bank's `PROTOCOL.md`, `progress.md`, `active-context.md`, `decisions.md`.

After work: append `progress.md`, refresh `active-context.md`. Lasting decisions → `DEC-NNN` in `decisions.md`.

If `memory-bank/` is missing, copy `_template/` before other work. Full protocol: `AGENTS.md`.
