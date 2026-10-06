# studio

Local UI for the agents in this collection. It lists agents, runs them, edits prompts and thresholds, reads library memory, and shows tool calls as they happen.

The studio calls independent localhost tRPC servers for [`ingest-classifier`](../ingest-classifier/) and [`project-manager`](../project-manager/). It does not run their pipelines in the web process.

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

The example registry also includes the project manager at `http://127.0.0.1:8788`. Start its independent server using the project-manager README. If an existing `agents.local.json` overrides the example, add the manager entry with `"kind": "project-manager"`. Entries without a `kind` continue to use the classifier workspace.

## What you can do

- **Run.** Ingest one inbox batch, search, ask, suggest splits, or backfill embeddings. Ask is the chat box. A run ends; continuous `watch` stays the classifier CLI.
- **Change the prompt.** Settings edits the organizer system prompt, the fit threshold, the dedup threshold, and how many recent corrections are appended. Save writes them into the library database. Reset restores the built-in prompt. The note stays the user message, and categories still arrive from `list_categories`.
- **Check memory.** Categories, stored documents, audit rows, and corrections. Corrections can be added or deleted. The other lists are read-only. This is the classifier's SQLite library, not `memory-bank/`.
- **See tool calls.** An ingest trace streams `list_categories`, `search_similar_notes`, `file_existing`, and `propose_child` with their arguments and results, including a rejected call.

## Project manager

- Create or select a project, then submit Markdown notes with optional source name/date and an explicit source version. Failed submissions keep their identity; stored notes have a dedicated retry action.
- Inspect storage and indexing separately. A stored source with a missing index remains visible and reports incomplete retrieval coverage.
- Accept, edit or reject proposed facts beside exact source passages. Review uses the current state revision; editing records a human confirmation. Pending changes remain outside approved facts.
- Ask questions in persisted, project-specific conversations. Answers show pending-review warnings, missing index coverage, approved claims and their exact citations.
- Open citations in the source inspector to verify the checksum and passage against the immutable snapshot. Open runs in the shared execution trace inspector.
- Read saved evaluation reports, including counts and denominators, targets, model/prompt/corpus versions, settings and individual failures. Live evaluations are started manually outside Studio.

## Checks

```bash
pnpm check
pnpm build
```

`pnpm typecheck` generates Next.js route/layout types before running TypeScript, so `pnpm check` also works in a clean checkout without a prior development server or build.

Verified on 2026-10-01: `pnpm check` and `pnpm build` pass. The classifier server tests cover config, corrections, and an offline ingest whose trace includes `list_categories` and `file_existing`. No live model call is required for those checks.
