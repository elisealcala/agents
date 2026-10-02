# Project manager

A local supervisor agent for collecting project notes, storing evidence through `ingest-classifier`, and producing cited status reports with blockers, next actions, and open questions. It appears in Studio as a separate agent.

The manager can make up to six analysis turns, retrieving more evidence when useful. Intake writes follow a fixed sequence and only mark a note stored after the classifier confirms that exact file. Project state and conversation history live in the manager's own SQLite database.

## Setup

Requires Node 22.22+, pnpm 10.9.0, and an Anthropic API key. Start the existing classifier on the same absolute library path first:

```bash
cd ingest-classifier
pnpm install --frozen-lockfile
pnpm serve -- --root /absolute/path/to/my-library
```

In another terminal, from the collection root:

```bash
cd project-manager
pnpm install --frozen-lockfile
cp .env.example .env
# Set ANTHROPIC_API_KEY and PROJECT_MANAGER_LIBRARY_ROOT in .env.
pnpm serve
```

Then start Studio:

```bash
cd studio
pnpm install --frozen-lockfile
pnpm dev
```

Open Project manager, create a project, submit a note, and analyze it. If `studio/agents.local.json` exists, add the project-manager entry from `agents.example.json` to that override. The default manager URL is `http://127.0.0.1:8788`.

## Example

Create **Website launch**, then submit this synthetic note:

```text
2026-10-01: Website launch is blocked on approved homepage copy.
Elizabeth owns the copy review. The design is ready.
Next step: review the homepage draft. Launch date is not confirmed.
```

After intake confirms storage, ask: **What is blocked and what should happen next?** A report should identify approved copy as a blocker, propose reviewing the homepage draft, and ask about the launch date, citing the actual stored note path. This is an expected outcome, not a recorded live-model result. Follow-up questions include previous reports and stored notes in context. Pending notes have a Retry intake action.

## Evaluation evidence

Offline behavioral verification and its results are documented in [verification.md](docs/verification.md). These tests use fake model responses and classifier results; they do not measure model quality. Live-model evaluation is still pending.

```bash
pnpm check
pnpm test
```

See [architecture.md](docs/architecture.md) for the benchmark-backed model recommendation, process boundaries, recovery limits, and future scaling choices.

## Source layout

- `src/application/`: contracts and intake/analysis orchestration.
- `src/providers/`: Anthropic supervisor and typed classifier client.
- `src/storage/`: project and run persistence.
- `src/server/`: manager tRPC router and localhost server.
- Tests live beside their modules. Development memory is in `memory-bank/`.
