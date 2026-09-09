# Active context — ingest-classifier

## Current focus

M1-M3 remain implemented. Source organization and local/CI quality gates are implemented and locally verified.

## Recent changes

- Moved modules and tests into responsibility folders and evaluation code to top-level evals/.
- Updated imports and command paths while preserving public exports and command names.
- Added ESLint, Biome, broader tsc coverage, compatible TypeScript 6.0.3, and GitHub Actions checks.

Verification passes: typecheck, ESLint, Biome, 174 tests, and all three offline evaluations. All 55 public exports are preserved, and deliberate type/lint/format failures are detected. GitHub execution awaits a push.

## Next steps

1. Review and commit the local changes; keep all quality checks and M1-M3 evaluations green.
2. Keep future source changes within the documented responsibility folders.
