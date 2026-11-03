# Stage 2 foundation publication verification

Date: 2026-11-02. Scope: publish the completed local Cloudflare-native foundation, not close Stage 2 or deploy infrastructure.

## Implemented boundary

- Owner-only Auth.js sign-in guards, same-origin allowlisted private transport, service/actor checks and degraded setup.
- Shared SQL driver contracts with separate Node and Durable Object manager/delivery/evidence ownership.
- Immutable hosted evidence reads, exact snapshot pairing, consistent offline backup preparation and resumable locked two-store import.
- Private backup alarm scheduling with verified R2 readback, restart-safe retries, status and authenticated last-good download.
- OpenNext/Cloudflare configuration, synthetic local Workers fixtures and the release/recovery runbook.

Hosted model extraction/answers, intake and search remain disabled. Delivery jobs are not yet driven by Worker lifecycle-independent scheduling; backup alarms are not proof of delivery-job execution. GitHub synchronization, QA and merge dispatch remain disabled.

## Fresh checks

| Component | Result | Limits |
| --- | --- | --- |
| Manager | Typecheck, lint and format pass; 248/248 tests across 28 files | Unit/component controls; local HTTP listeners allowed for test cases |
| Manager Worker | Dry-run bundle passes for both Durable Object classes and R2 binding | No resource creation or deployment |
| Studio | Typecheck, lint and format pass; 51/51 tests; OpenNext build including Next.js production build passes | Sessions/credentials used by fixtures are synthetic; not actual OAuth |
| Evidence adapter | Typechecks, package lint/format and 227/227 tests across 29 files pass; four offline evaluations pass | No model calls or actual database reads; durable storage is not hosted intake/search |
| Two-Worker fixture | Built Studio and separate storage Worker: init/import/access checks and inspect after restart pass | Local Workers, synthetic identities and data |
| Alarm/R2 fixture | Locked-state check, import, verified readback, rearm and overdue-alarm inspect after restart pass | Local Durable Objects/R2; no hosted retention or recovery claim |
| Publication scope | Whitespace and candidate path/credential-marker checks pass | Ignore generated/runtime/private files; preserve unrelated collection/career work |

The Manager check configuration now excludes ignored local runtime directories from package checks. The simulator's Python-generated JSON keeps its generator formatting; source lint/format remain enforced. No simulation report content or expected outcome changed.

## Remaining work
Publication commit: `7b4beea5ce7960cd504705b6e8124032ea4b15a0` on `origin/main`. The initial hosted run 41565416133 found missing classifier/manager source dependencies in the clean-checkout CI jobs. Repair commit `5887b40ae4230c19871c96aca30339f6872dc44b` installs sibling packages with their independent frozen lockfiles before checking the consuming package and keys its cache with all relevant lockfiles. No check was removed. [GitHub run 41565576888](https://github.com/elisealcala/agents/actions/runs/41565576888) passed all four jobs: Manager, Studio (including production build), classifier and TypeScript starter. This is clean-checkout CI evidence, separate from the local Cloudflare probes above and from still-required hosted application acceptance.


Stage 2 stays open at [#22](https://github.com/elisealcala/agents/issues/22). Its 12 native child issues [#103–#114](https://github.com/elisealcala/agents/issues/22) cover reproducible Cloudflare CI, durable delivery wakeups, private R2/retention, OAuth/secrets, deployment, live private-boundary/auth verification, consistent data cutover, actual backup/restore drills, degraded setup and final hosted acceptance. See [small-session backlog](small-session-backlog.md).

Local publication does not satisfy the Stage 2 browser/restore gate. The intended address remains https://project-manager.ezth.workers.dev; this task did not deploy it, register credentials, change cloud resources, touch actual backup contents or restart the original manager/classifier owners. Keep Stage 3 gated until #22 is accepted.
