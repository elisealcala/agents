# AGENT_NAME

TODO: Describe what this agent does, who it helps, and its main input and output in one or two sentences.

## Setup and usage

TODO: List prerequisites, required configuration (without secrets), installation steps, and the command to run the agent.

## Project structure

Keep documentation, tool configuration, and `memory-bank/` at the agent root. Group application code by responsibility and keep unit tests beside the modules they exercise. Add folders when needed; an agent does not need every folder below.

```text
src/
  index.*             # public exports, when the agent exposes a library
  cli.*               # command entry point
  config.*            # environment/configuration loading
  <responsibility>/   # related modules and their unit tests
  providers/          # external model/service adapters
evals/                # evaluation runners, fixtures, and their tests
examples/             # reproducible sample input/output, when available
docs/                 # longer guides and demo/evaluation evidence, when needed
memory-bank/          # this agent's development memory
```

Use concrete responsibility names such as `classification`, `pipelines`, `files`, `storage`, `taxonomy`, or `search`. Keep evaluation-only clients in `evals/` and update their imports when moving modules. Avoid a growing pile of unrelated files or a catch-all `utils/` folder.

## Optional TypeScript starter

The general template stays language-neutral. For a TypeScript agent, the preset supplies Node 22.22+, pnpm 10.9.0, TypeScript 6.0, ESLint, Biome, Vitest, a minimal CLI, and a CLI smoke test. Each agent installs its own dependencies and keeps its own lockfile.

From the collection root, start with a fresh folder name:

```bash
rsync -a --exclude=node_modules --exclude=dist --exclude=coverage _template/ my-agent/
# Copy the versioned preset, including its .gitignore; exclude local dependencies.
rsync -a --exclude=node_modules --exclude=dist --exclude=coverage \
  _template/presets/typescript/ my-agent/
rm -rf my-agent/presets
cd my-agent
npm pkg set name=my-agent
pnpm install --frozen-lockfile
pnpm start
pnpm check
pnpm test
```

Replace `my-agent` with the new folder/package name, then complete the contributor setup below. The CLI's readiness message demonstrates only that the starter runs; replace it with the agent workflow and provide actual product evidence in the sections below.

### Quality checks

| Command | Purpose |
|---|---|
| `pnpm typecheck` | Run `tsc --noEmit` over source, tests, evaluations, and TypeScript tool configuration |
| `pnpm lint` | Run recommended JavaScript/TypeScript ESLint rules; warnings fail |
| `pnpm lint:fix` | Apply supported ESLint fixes |
| `pnpm format:check` | Check Biome formatting without editing files |
| `pnpm format` | Apply Biome formatting |
| `pnpm check` | Run type, lint, and formatting checks |
| `pnpm test` | Run the unit and smoke tests |

ESLint owns code rules. Biome owns formatting (two spaces, double quotes, semicolons), with its linter and assists disabled. TypeScript 6.0 is pinned for compatibility with the ESLint TypeScript integration. Keep the lockfile committed and use the pinned pnpm version.

The collection's GitHub Actions workflow checks `ingest-classifier` and a temporary agent assembled from this preset on pull requests and pushes to `main`. When adding another TypeScript agent, add a dedicated job following the existing agent job, with its own working directory and lockfile; add its evaluation commands when available.

## Example input/output

TODO: Replace the placeholders below with one small, reproducible example from this agent. Include any configuration or initial state needed to reproduce it. Use synthetic or sanitized data.

**Input**

```text
TODO: Exact example input, or the contents of a linked sample file.
```

**Run**

```text
TODO: Exact command or steps that process this input.
```

**Output**

```text
TODO: Observed output from that run, including relevant generated files or state changes.
```

TODO: Explain what the output demonstrates and which parts may vary between runs.

## Demo or evaluation results

Provide at least one of the following before presenting this agent as ready to use. Keep both if available, and remove the unused subsection. These are placeholders, not recorded evidence.

### Recorded demo

- Recording: TODO — link to a playable video or GIF showing the example above.
- Recorded on / revision: TODO — date and commit identifier.
- Walkthrough: TODO — briefly describe the input, execution, and result shown; include timestamps if useful.

### Evaluation results

- Evaluated on / revision: TODO — date and commit identifier.
- Reproduce: TODO — exact command, prerequisites, runtime/model versions, and relevant configuration.
- Dataset: TODO — fixture or dataset link, version, number of cases, and how cases were selected.

| Metric | Observed result | Success criterion |
|---|---|---|
| TODO: Name and definition | TODO: Measured value; include numerator/denominator for rates | TODO: Target or pass condition |

- Evidence: TODO — link to the saved report or run output.
- Limitations: TODO — failures, excluded cases, and what this evaluation does not establish.

## Contributor setup

This folder starts from the collection template and does not choose a runtime for you.

1. Copy this directory to `../<agent-name>/`.
2. Replace `AGENT_NAME` in `README.md`, `AGENTS.md`, `CLAUDE.md`, and `memory-bank/*`.
3. Register the agent in `_collection/memory-bank/progress.md`.
4. Choose this agent's runtime and record it as `DEC-001` in **this** bank.
5. All further work uses `./memory-bank/` only.
6. Complete the setup, example, and demo or evaluation sections above with actual commands and evidence; remove all `TODO` placeholders before presenting the agent as ready to use.

The collection protocol lives in the repo-root `AGENTS.md`. This template does not pick LangGraph, Python, or TypeScript for you.
