# Active context — ingest-classifier

## Current focus

M1 is implemented and verified. The next implementation ticket is [#10 persisted categories](https://github.com/elisealcala/agents/issues/10), beginning M2 dynamic taxonomy.

## Recent changes

- M1 added the library contract, polling scanner, clean Markdown parser, structured classifier, safe mover, SQLite audit store, and a reproducible 20-file offline eval.
- M1 verification passed: typecheck, 70 tests, and the 20/20 zero-loss exit gate.
- `DEC-004`–`DEC-006` record fallback, move, and recommended-model behavior.

## Next steps

1. Implement M2 in issue order (#10 → #14). Do not start M3 until #14 passes.
2. Persist seed categories as first-class SQLite rows, then build dynamic prompting and semantic dedup around the live table.
