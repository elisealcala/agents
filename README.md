# Agents

A collection of independent AI agents for document intake, classification, and retrieval, with per-agent runtimes and memory banks.

This repository currently ships [`ingest-classifier`](ingest-classifier/), a local Markdown intake agent that turns an inbox of notes into an organized, searchable library.

## ingest-classifier

`ingest-classifier` watches or scans an `inbox/`, reads Markdown without modifying the source during classification, and files each note into a category with a SQLite audit trail. Its taxonomy can grow when a note does not fit an existing category, while semantic deduplication prevents near-duplicate folders.

The agent also stores document summaries, clean text, and embeddings so it can:

- remember classification corrections;
- suggest splits for crowded categories without moving files automatically;
- answer natural-language questions with citations to the source files.

OpenAI, Anthropic, and xAI models are selectable through environment variables. Offline evaluation commands cover the zero-loss pipeline, adaptive taxonomy, clustering suggestions, and grounded retrieval.

```bash
cd ingest-classifier
pnpm install
cp .env.example .env

pnpm run -- --root ./my-library
pnpm watch -- --root ./my-library
pnpm eval:fixed-taxonomy
pnpm eval:adaptive-taxonomy
pnpm eval:retrieval-and-clustering
```

See the [`ingest-classifier` README](ingest-classifier/README.md) for setup, the library layout, available commands, and configuration.

The [`studio`](studio/) is a local Next.js app for running that agent, editing its prompt and thresholds, reading library memory, and inspecting tool calls. Start the classifier server with `pnpm serve` inside `ingest-classifier`, then `pnpm dev` inside `studio`.

## Project manager

[`project-manager`](project-manager/) adds a local Studio workspace for project notes, proposed facts, human review, approved state and grounded questions. It stores evidence through a dedicated classifier library, preserves immutable citations and keeps pending conflicts outside definitive answers. Its evaluation runner includes 64 labeled synthetic documents, 40 questions and a project-level holdout. Fixture results validate controls; live and representative-note accuracy remain separate measurements. See its README for setup and evaluation commands.

## Coding-agent collection

The repository is also structured as a collection of independent, runnable agents. Each agent can use a different stack (LangGraph, custom orchestration, or anything else). What they share is a **memory-bank process**, not a runtime.

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
rsync -a --exclude=node_modules --exclude=dist --exclude=coverage _template/ my-agent/
# then replace AGENT_NAME in that folder
```

1. Replace `AGENT_NAME` placeholders.
2. Register the agent in `_collection/memory-bank/progress.md`.
3. Record this agent's runtime as `DEC-001` in **its** `decisions.md`.
4. Do product work only in that agent's bank.
5. Complete the agent README with a runnable example input/output and either a recorded demo or evaluation results. Replace the template placeholders with evidence from the implemented agent before presenting it as ready to use.

Follow the [template's project structure and optional TypeScript starter](_template/README.md#project-structure). Keep code grouped by responsibility, tests beside their modules, and evaluations in `evals/`. The TypeScript preset includes Biome linting and formatting, type checking, and tests without imposing TypeScript on other agents.

GitHub Actions checks the classifier, project manager, Studio and a newly assembled TypeScript starter on pull requests and pushes to `main`. Each package owns its checks; the classifier retains its four offline evaluations and the manager adds a synthetic control replay.

Full loop: [`AGENTS.md`](AGENTS.md).

## Status

The collection includes [`ingest-classifier/`](ingest-classifier/), [`project-manager/`](project-manager/) and their local [`Studio`](studio/). Each keeps its own runtime and memory bank.
