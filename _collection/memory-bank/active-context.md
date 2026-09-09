# Active context — _collection

## Current focus

The template now documents source organization and provides an optional, independently installable TypeScript preset with local checks and GitHub Actions coverage.

## Recent changes

- Documented responsibility folders, colocated tests, and separate evaluation runners.
- Added a minimal TypeScript CLI, smoke test, local ESLint/Biome/tsc commands, and a lockfile.
- Added separate GitHub Actions jobs for the existing agent and a newly assembled TypeScript starter.

Local verification passes for both the preset and an independently assembled starter, including frozen installs, all quality checks, the smoke test, and deliberate-error detection. Workflow configuration is validated; it has not run on GitHub yet.

## Next steps

1. Publish the verified changes to `main` as requested, then inspect the configured GitHub checks. Unrelated `.cursor/plans/` files stay local.
2. Keep runtime-specific implementation details in each product memory bank.
