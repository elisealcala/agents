# ingest-classifier

TypeScript ETL intake agent. This slice only picks a model (OpenAI GPT, Anthropic Claude, or xAI Grok) via environment variables and runs a smoke completion.

Classification (`classify_file`, `classify_records`) is a later slice.

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
pnpm start    # smoke completion
pnpm test
```
