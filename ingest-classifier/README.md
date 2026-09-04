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
pnpm run -- --root ./my-library    # adaptive classification, once
pnpm watch -- --root ./my-library  # adaptive classification, polling
pnpm eval:m1                       # offline 20-file zero-loss gate
pnpm eval:m2                       # offline 57-file adaptive-taxonomy gate
pnpm eval:m3                       # offline split-suggestion and grounded-Q&A gate
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

## Adaptive taxonomy

The production `run` and `watch` commands load categories from SQLite on every classification. When the model reports an existing-category fit above 0.80, the note uses that category. Otherwise it proposes a name and one-sentence definition without moving the file yet.

Before creation, `local-hash-v1` embeds the proposal and compares it to stored category vectors. Similarity above `INGEST_CATEGORY_DEDUP_THRESHOLD` (default `0.85`) reuses the nearest category. A novel proposal is inserted in SQLite, its matching folder is created, and only then can the checksum-safe move occur.

`pnpm eval:m2` runs 57 notes offline in two waves. It verifies that novel equipment-maintenance and cooking themes create exactly one folder each, later related notes reuse them, an architecture paraphrase merges into the seed category, every note has a complete audit row, and no stored category pair crosses the duplicate threshold. The JSON report includes the human-review theme checklist.

## Document memory, corrections, and retrieval

Every adaptively sorted note stores its clean text, summary, destination path, and `local-hash-v1` embedding in SQLite. Embedding failures create an explicit `missing` document row so the gap is visible and repairable. Backfill M1/M2 audit records with:

```bash
pnpm backfill -- --root ./my-library
```

Record a durable correction (the five most recent corrections become few-shot prompt examples):

```bash
pnpm correct -- --root ./my-library --path ./library/architecture-code/retro.md \
  --wrong architecture_code --correct meeting_notes --note "Retrospective action items are meetings."
```

Generate suggestion-only clustering output. This reads stored vectors and writes a report; it never moves files:

```bash
pnpm cluster -- --root ./my-library
# writes ./my-library/cluster-suggestions.json
```

Ask a grounded question. The query alone is embedded; stored document vectors are reused. The answer includes only retrieved file citations and says so when nothing relevant is found:

```bash
pnpm ask -- --root ./my-library --question "What were the Q3 cache takeaways?"
```

`pnpm eval:m3` creates a mixed architecture library, proves a caching/authentication split suggestion without moving anything, records a correction, and answers a known caching question with citations to retrieved fixture files.
