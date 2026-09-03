# Active context — ingest-classifier

## Current focus

Model picker is in place. Do not start classification until the next plan.

## Recent changes

- TypeScript package with `ModelClient` (`complete`).
- Providers: openai, anthropic, xai (OpenAI SDK + `https://api.x.ai/v1`).
- Env: `INGEST_PROVIDER`, `INGEST_MODEL`, plus `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `XAI_API_KEY`.
- `pnpm start` sends one smoke prompt and prints `{ provider, model, text }`.

## Next steps

1. Add `classify_file` and `classify_records` using `ModelClient`.
2. Keep provider selection as an env-only change.
