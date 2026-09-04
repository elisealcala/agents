# Active context — ingest-classifier

## Current focus

M1 and M2 are implemented and verified. The next implementation ticket is [#16 document embeddings](https://github.com/elisealcala/agents/issues/16), beginning M3 retrieval and re-clustering.

## Recent changes

- M2 persists seeds and novel categories in SQLite, builds prompts from the live table, enforces the 0.80 fit boundary, and serializes semantic dedup/create operations.
- `local-hash-v1` vectors make the 0.85 duplicate threshold deterministic, private, and provider-independent.
- M2 verification passed: typecheck, 134 tests, M1 regression eval, and the 57/57 adaptive gate with zero duplicate pairs.

## Next steps

1. Implement M3 in issue order (#16 → #20).
2. Store document vectors/clean text first, then corrections, suggestion-only clustering, and cited retrieval.
