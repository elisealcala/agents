# Progress — studio

## Status

Current: Local Next.js studio drives `ingest-classifier` over tRPC.
Next: Try a live library run from the UI.

## Checklist

- [x] Decide: Next.js client, per-agent tRPC server (`DEC-001`)
- [x] Agent list, ask thread, run actions, trace inspector, settings sheet, memory view
- [x] `pnpm check` and `pnpm build`
- [ ] Live library run from the UI against a real model

## Log

### 2026-10-01

- Scaffolded the Next.js app with shadcn/ui.
- The workspace calls the classifier router for runs, config, corrections, memory, and the live trace subscription.
- Settings and traces stay in the library database owned by `ingest-classifier`.

### 2026-10-01 — Ask reply and font

- The chat was keeping the first fetch of a run, which was still `running`, so the reply never appeared even after the trace finished. It now refetches until the run ends and also reads the finished `ask_question` span. The question is shown above the reply.
- `--font-sans` pointed at itself, so the page used the browser default. It now uses Geist.
