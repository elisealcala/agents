# Active context — _collection

## Current focus

Memory-bank protocol is in place. Next product work is `ingest-classifier`, not more collection infrastructure.

## Recent changes

- Root protocol for Cursor, Claude Code, and Codex.
- `_collection` bank created and used for this scaffold.
- `_template` ready to copy.

## Next steps

1. Copy `_template/` → `ingest-classifier/`.
2. Fill `AGENT_NAME` placeholders and write the first `ingest-classifier` bank entries.
3. Implement classifier code **using `ingest-classifier/memory-bank/`**, not this bank.

## Open questions

None for the collection protocol. Classifier runtime (Python vs LangGraph vs TypeScript) is an `ingest-classifier` decision.
