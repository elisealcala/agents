# studio

Local UI for the agents in this collection. It lists agents, runs them, edits prompts and thresholds, reads library memory, and shows tool calls as they happen.

The first agent is [`ingest-classifier`](../ingest-classifier/). The studio does not run that pipeline itself. It calls the classifier's localhost tRPC server.

## Setup

Requires Node 22.22 or newer and pnpm 10.9.0.

```bash
cd studio
pnpm install
pnpm dev
```

In another terminal, start the classifier server against a library:

```bash
cd ingest-classifier
pnpm serve -- --root ./my-library
```

Open http://localhost:3000. The example registry points at `http://127.0.0.1:8787`. Copy `agents.example.json` to `agents.local.json` to change the URL or add another TypeScript agent later. `agents.local.json` is gitignored.

## What you can do

- **Run.** Ingest one inbox batch, search, ask, suggest splits, or backfill embeddings. Ask is the chat box. A run ends; continuous `watch` stays the classifier CLI.
- **Change the prompt.** Settings edits the organizer system prompt, the fit threshold, the dedup threshold, and how many recent corrections are appended. Save writes them into the library database. Reset restores the built-in prompt. The note stays the user message, and categories still arrive from `list_categories`.
- **Check memory.** Categories, stored documents, audit rows, and corrections. Corrections can be added or deleted. The other lists are read-only. This is the classifier's SQLite library, not `memory-bank/`.
- **See tool calls.** An ingest trace streams `list_categories`, `search_similar_notes`, `file_existing`, and `propose_child` with their arguments and results, including a rejected call.

## Checks

```bash
pnpm check
pnpm build
```

Verified on 2026-10-01: `pnpm check` and `pnpm build` pass. The classifier server tests cover config, corrections, and an offline ingest whose trace includes `list_categories` and `file_existing`. No live model call is required for those checks.
