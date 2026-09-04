# ingest-classifier

TypeScript agent that watches a Markdown inbox, classifies notes, moves them without overwriting user data, and records every stage in SQLite. OpenAI GPT, Anthropic Claude, and xAI Grok remain env-only swaps.

## Setup

```bash
cd ingest-classifier
pnpm install
cp .env.example .env   # fill the key for the provider you pick
```

## Pick a model

| Env | Meaning |
|---|---|
| `INGEST_PROVIDER` | `openai` \| `anthropic` \| `xai` |
| `INGEST_MODEL` | Vendor model id |
| `OPENAI_API_KEY` | When provider is `openai` |
| `ANTHROPIC_API_KEY` | When provider is `anthropic` |
| `XAI_API_KEY` | When provider is `xai` |

```bash
pnpm start                         # provider smoke completion
pnpm run -- --root ./my-library    # process the inbox once
pnpm watch -- --root ./my-library  # poll continuously
pnpm eval:m1                       # offline 20-file zero-loss gate
pnpm test
```

## Library contract

The `--root` folder is created when necessary and contains:

```text
<root>/
  inbox/
  library/
    project-specs/
    architecture-code/
    meeting-notes/
    personal-ideas/
    reference-material/
  ingest-classifier.sqlite
```

The stable category IDs and definitions live in `src/taxonomy.ts`. Files below 0.50 confidence are safely filed under `reference_material`; invalid model responses are retried, audited as failed, and left in the inbox. Destination collisions use `name-2.md`, `name-3.md`, and so on, and never overwrite an existing file.

Only `.md` files move. Other files remain in the inbox and receive a single `skipped` audit record. UTF-8 parse failures remain in place, receive a failed audit record, and do not stop the rest of a batch.

`pnpm eval:m1` creates an isolated temporary library with 20 valid, diverse Markdown notes plus invalid/ignored inputs. It succeeds only when all 20 valid notes move to seed folders and have complete audit rows; the printed temporary path can be inspected after the run.
