# Project manager

Local project workspace with immutable note evidence, reviewed facts, versioned state, and grounded questions. The manager delegates storage and passage search to `ingest-classifier`; its own SQLite database holds projects, proposals, review decisions, conversations, runs and evaluation reports.

## Start the local pilot

Requires Node 22.22 or newer and pnpm 10.9.0. Install dependencies in `ingest-classifier`, `project-manager` and `studio` independently. Copy `.env.example` to `.env` in the manager folder and set `PROJECT_MANAGER_MODEL`, `ANTHROPIC_API_KEY`, and an **absolute** `PROJECT_MANAGER_LIBRARY_ROOT`. There is no hidden model choice. Use the same library root in both server processes.

Start a dedicated classifier server in another terminal. Configure its model/key using the classifier's `.env` or `--env-file`:

```bash
cd ingest-classifier
pnpm install
pnpm serve -- --root /absolute/path/to/project-evidence --port 8789
```

Keep this library separate from the ordinary classifier library, and do not run its watcher: the watcher holds the ingestion lock.

```bash
cd project-manager
pnpm install
cp .env.example .env
# Fill the model, key and absolute library root in .env.
pnpm serve
```

```bash
cd studio
pnpm install
pnpm dev
```

Open Studio at `http://localhost:3000` and choose **Project manager**. The example registry includes port 8788. If `studio/agents.local.json` overrides it, add the manager entry from `studio/agents.example.json`, including `"kind": "project-manager"`.

Run one manager service per database. Stop that service before replaying evaluations into its database, then restart it to inspect saved results. Startup recovery marks interrupted runs and intakes as failures that can be inspected and retried; it does not silently confirm them.

## Try a reviewed fact

Create a project named Atlas, then submit this Markdown with source name `kickoff`, version `1`, and source date `2026-01-01`:

```markdown
# Atlas kickoff
Task "Launch checklist" has owner "Ana Rivera" effective 2026-01-01.
Task "Launch checklist" has due date "2026-01-12" effective 2026-01-01.
```

The intake run stores the exact source, extracts candidate facts and opens the review queue. Approved state stays empty until you accept or edit a proposal. After accepting both facts, ask “Who is the owner and what is the due date for Launch checklist?” The answer selects approved facts and shows their values with immutable source citations. Open a citation to inspect the exact passage, or a run to inspect its trace. More replayable notes are in [examples/atlas](examples/atlas/).

Conflicting current fields require review before a definitive answer. Undated values stay undated. An older approved event remains in history without reverting current state. Reviewer edits cite an explicit human confirmation, while retaining the original candidate and correction in review history.

## Accuracy evaluation

```bash
pnpm eval:accuracy --mode fixture --split all \
  --database /tmp/project-manager-evaluation.sqlite \
  --output /tmp/project-manager-evaluation.json
```

The frozen corpus contains eight projects, eight documents each and five questions each; five projects are for development and three are held out. Module evaluations and complete replays report counts, denominators, omissions, errors, source coverage and the first failing module. One-pass and six-turn answers share a total budget of five retrieved passages and run three times. Review never fills omissions before scoring.

Fixture mode uses a grammar parser and evidence simulator. It validates deterministic controls and scoring; its results do not establish LLM accuracy. Live mode uses the configured Anthropic model and the actual classifier, with explicit model prices and a manager-model cost cap. Classifier-model costs are separate. See [evaluation data and live commands](docs/evaluation-data.md), [architecture](docs/architecture.md), and [verification evidence](docs/verification.md).

The initial release is a local pilot. The proposed precision/recall gates require live measurement; representative sanitized project notes require a separate frozen evaluation before real-world accuracy claims.

## Package boundaries

- `src/application`: typed contracts, evidence validation, intake, review and answering.
- `src/storage`: manager-owned state, recovery, run traces and reports.
- `src/providers`: typed classifier client and Anthropic adapter.
- `src/server`: localhost tRPC operations consumed by Studio.
- `evals`: frozen corpus, scoring and manual replay runner.

Questions use approved state and approved source passages. Models select fact IDs; code renders their factual values. Additional retrieval never modifies state. Connectors, scheduling, forecasting, automatic assignment and external actions are outside this version.
