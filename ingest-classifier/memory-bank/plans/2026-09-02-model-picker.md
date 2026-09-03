# Plan: model picker

Status: done (2026-09-02)

## Goal

Prove ingest-classifier can pick one of OpenAI, Anthropic, or xAI via env vars and get a completion back.

## Pieces

1. Copy `_template/` → `ingest-classifier/` and fill the bank.
2. TypeScript package (`package.json`, `tsconfig.json`, `.env.example`).
3. `ModelClient` + openai / anthropic / xai providers + env factory.
4. `pnpm start` smoke CLI.
5. Vitest for factory/config (no live network).

## Out of scope

- `classify_file` / `classify_records`
- LangGraph
- Cursor SDK
