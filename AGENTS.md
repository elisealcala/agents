# Agent collection protocol

This repository is a **collection of independent agents**. Each agent has its own runtime (LangGraph, custom orchestration, or anything else) and its **own** `memory-bank/`.

There is **no shared memory bank**. Root files here are protocol only.

This file is binding for Cursor, Claude Code, Codex, and any other coding agent that reads `AGENTS.md`.

## Which bank to use

| You are working on | Bank |
|---|---|
| Root protocol, Cursor/Claude/Codex rules, `_template`, or this collection itself | `_collection/memory-bank/` |
| A specific agent folder | `<that-folder>/memory-bank/` |

Never read or write another agent's bank. Never merge banks.

If the agent folder has no `memory-bank/`, copy `_template/` (or at least `_template/memory-bank/`) before doing other work.

## Session loop (mandatory)

1. Identify the agent folder for this task.
2. Read that agent's `memory-bank/PROTOCOL.md`, `progress.md`, `active-context.md`, and `decisions.md`.
3. Do the work.
4. After every task: append a dated entry to `progress.md` and refresh `active-context.md`.
5. When a decision sticks: add `DEC-NNN` to `decisions.md`. Do not leave decisions only in chat.

Confirm the memory-bank update to the user when the task involved code or protocol changes.

## New agents

1. Copy `_template/` to a new folder name.
2. Replace placeholders (`AGENT_NAME`).
3. Register the new agent in `_collection/memory-bank/progress.md`.
4. Only then start product work, using the **new** agent's bank.

## Do not

- Put project memory in root `AGENTS.md` or `CLAUDE.md`.
- Track `ingest-classifier` (or any product agent) inside `_collection` beyond "it exists / next up".
- Skip the loop because the change was "small".
