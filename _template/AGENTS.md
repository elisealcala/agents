# AGENT_NAME

Copy `_template/` to a new folder, then replace `AGENT_NAME` everywhere (folder name, this file, `CLAUDE.md`, `memory-bank/` titles).

**Bank:** [`memory-bank/`](memory-bank/)

This agent follows the collection protocol in the repo-root `AGENTS.md`. Use **this folder's** `memory-bank/` only.

1. Before work: read `memory-bank/PROTOCOL.md`, `progress.md`, `active-context.md`, `decisions.md`.
2. After work: update `progress.md` and `active-context.md`.
3. Lasting decisions: add `DEC-NNN` to `decisions.md`.

Plug in whatever runtime this agent needs (LangGraph, custom orchestration, etc.). The template does not assume a stack.
