<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# studio

**Bank:** [`memory-bank/`](memory-bank/)

Local Next.js app for running agents in this collection, editing their settings, and reading their traces. The first agent is `ingest-classifier`.

This folder follows the collection protocol in the repo-root `AGENTS.md`. Use **this folder's** `memory-bank/` only.

1. Before work: read `memory-bank/PROTOCOL.md`, `progress.md`, `active-context.md`, `decisions.md`.
2. After work: update `progress.md` and `active-context.md`.
3. Lasting decisions: add `DEC-NNN` to `decisions.md`.

The app imports the classifier router as a type. It does not call `createIngestAgent`.

