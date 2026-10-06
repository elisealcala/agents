# Local pilot verification — 2026-10-05

Source: local working tree based on `c951cad`. Checks were delegated to the verifier after implementation, followed by one batched repair and a final verification pass. No live model calls were made.

## Package and integration checks

| Scope | Result |
|---|---|
| Manager types, lint and formatting | Passed |
| Manager unit/integration tests | 85/85 passed |
| Classifier types, lint and formatting | Passed |
| Classifier tests, including real evidence pipeline/storage tests | 223/223 passed |
| Existing classifier fixed-taxonomy, adaptive-taxonomy, retrieval/clustering and MCP evaluations | All four passed |
| Studio types, lint and formatting | Passed |
| Studio production build with `--webpack` | Passed |
| Frozen dependency installations | All three passed |
| Actual HTTP handler and typed client | Intake, review, answers, citations and project isolation passed |
| Browser workflows | Project creation/intake, accept/edit/reject, human confirmations, pending clarification, project switching, citation navigation and evaluation-to-trace navigation passed |

The default Studio build encountered sandbox restrictions fetching Google Fonts. The supported Webpack build completed successfully. Verification used temporary databases and deterministic models/workers. Owned test servers and browser tabs were stopped afterward.

## Synthetic control replay

[Full recorded report](../evals/reports/fixture-controls-2026-10-05.json). Corpus: `project-histories-v2`, SHA-256 `77a13fe5fa87cf8a24e919dfdb613aa7855384580dc3c631804391f9d912d99e`.

| Control | Observed numerator / denominator |
|---|---|
| Source integrity, integrated and isolated registration | 128/128 |
| Duplicate-free replay | 16/16 |
| Required retrieval span coverage | 53/53 |
| Project-filter cases | 40/40 |
| Integrated extraction precision / recall | 96/96 for each |
| Pre-review change precision / recall | 77/77 for each |
| Approved-state checkpoints | 64/64 |
| Stale-reversion challenge controls | 8/8 |
| Answer precision / completeness, each policy | 111/111 for each |
| Whole-case success, each policy | 120/120 |
| Holdout whole-case success, each policy | 45/45 |

The corpus has **64 distinct documents and 40 distinct questions**. Registration counts include isolated/integrated replay; answer counts include three repetitions of the same questions. Repetitions do not create independent samples. The fixture grammar and lexical evidence simulator produced zero recorded failures, with all defined control gates passing. Neither policy improved on the other in this control run; this cannot select the live orchestration policy.

Reproduce from `project-manager/` with a fresh database:

```bash
pnpm check
pnpm test
pnpm eval:accuracy --mode fixture --split all \
  --database /tmp/project-manager-control.sqlite \
  --output /tmp/project-manager-control.json
```

Studio build reproduction: `pnpm check` and `pnpm build --webpack` inside `studio/`. Existing classifier evaluations remain its original four commands in CI.

These results establish controlled behavior and scoring. **Live Anthropic accuracy, live classifier retrieval coverage and representative-note accuracy remain unmeasured.** See [evaluation-data.md](evaluation-data.md) for manual live commands, explicit pricing and the separate classifier-cost boundary.
