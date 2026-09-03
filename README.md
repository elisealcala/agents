# Agents

A collection of independent, runnable agents. Each agent can use a different stack (LangGraph, custom orchestration, or anything else). What they share is a **memory-bank process**, not a runtime.

Repo: [github.com/elisealcala/agents](https://github.com/elisealcala/agents)

## Layout

```
.
├── AGENTS.md              # protocol (Cursor, Codex, and others)
├── CLAUDE.md              # Claude Code entry
├── .cursor/rules/         # Cursor always-on rule
├── .claude/rules/         # Claude Code rule
├── .codex/AGENTS.md       # Codex pointer
├── _collection/           # repo agent — protocol and scaffolding only
├── _template/             # copy this to start a new agent
└── <agent-name>/          # one folder per product agent
```

There is **no shared memory bank**. Root files are protocol only. `_collection` is not a product agent; its bank tracks this repo.

## Memory bank

Every agent folder (including `_collection` and `_template`) owns `memory-bank/`:

| File | Role |
|---|---|
| `PROTOCOL.md` | Read/write loop for any coding agent |
| `progress.md` | Status, checklist, dated log |
| `decisions.md` | Registry (`DEC-001`, `DEC-002`, …) |
| `active-context.md` | Current focus and next steps |
| `plans/` | One markdown file per work piece |

Working on collection protocol or `_template` → `_collection/memory-bank/`.  
Working inside an agent → that agent's `memory-bank/`.  
Never merge banks.

## Add an agent

```bash
cp -R _template ingest-classifier
# then replace AGENT_NAME in that folder
```

1. Replace `AGENT_NAME` placeholders.
2. Register the agent in `_collection/memory-bank/progress.md`.
3. Record this agent's runtime as `DEC-001` in **its** `decisions.md`.
4. Do product work only in that agent's bank.

Full loop: [`AGENTS.md`](AGENTS.md).

## Status

Memory-bank protocol is in place. Product agent: [`ingest-classifier/`](ingest-classifier/) (model picker done; classification not started).
