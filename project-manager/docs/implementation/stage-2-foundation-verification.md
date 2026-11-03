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

Stage 2 stays open at [#22](https://github.com/elisealcala/agents/issues/22). Its 12 native child issues [#103–#114](https://github.com/elisealcala/agents/issues/22) cover reproducible Cloudflare CI, durable delivery wakeups, private R2/retention, OAuth/secrets, deployment, live private-boundary/auth verification, consistent data cutover, actual backup/restore drills, degraded setup and final hosted acceptance. See [small-session backlog](small-session-backlog.md).

Local publication does not satisfy the Stage 2 browser/restore gate. The intended address remains https://project-manager.ezth.workers.dev; this task did not deploy it, register credentials, change cloud resources, touch actual backup contents or restart the original manager/classifier owners. Keep Stage 3 gated until #22 is accepted.
