# Active context — project-manager

## Current focus
First local version is implemented and verified offline: 17 tests, type/lint/format checks, typed HTTP integration and Studio Webpack build passed. Input is Studio notes and existing classifier library retrieval.

## Next steps
1. Configure the library path and API key; start classifier, manager and Studio using README instructions.
2. Run real intake and model analysis; evaluate Sonnet 5.5 against Opus 5.5 on sanitized project histories.
3. Add connectors or durable scheduling only when required.

## Limits
Default Turbopack build hit this environment’s PostCSS port-binding restriction; Webpack production build passed. Live model quality, real classifier integration and browser interaction remain unverified.
