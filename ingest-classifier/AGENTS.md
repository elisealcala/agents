# ingest-classifier

**Bank:** [`memory-bank/`](memory-bank/)

Markdown intake classifier with adaptive taxonomy, document memory, clustering suggestions, and grounded retrieval. OpenAI, Anthropic, and xAI are selectable providers.

This agent follows the collection protocol in the repo-root `AGENTS.md`. Use **this folder's** `memory-bank/` only.

1. Before work: read `memory-bank/PROTOCOL.md`, `progress.md`, `active-context.md`, `decisions.md`.
2. After work: update `progress.md` and `active-context.md`.
3. Lasting decisions: add `DEC-NNN` to `decisions.md`.

Source is grouped by responsibility under `src/`, with tests beside modules. Offline evaluation runners and fixture clients live in `evals/`. Preserve the exports in `src/index.ts` and existing package command names when reorganizing internal modules.

After implementation, verification covers `pnpm check`, `pnpm test`, and all three offline milestone evaluations (`pnpm eval:m1`, `pnpm eval:m2`, `pnpm eval:m3`). See `README.md` for the folder map and tool commands.
