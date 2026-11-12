# Stage 2 hosted acceptance (GH-114)

Status: **NOT ACCEPTED.** Required gates remain open, so #22 stays open and Stage 3 (#29) is not started. This page summarizes the linked evidence; it adds no new hosted observations.

## Deployment identity

- URL: `https://project-manager.ezth.workers.dev` (web Worker `project-manager`); storage Worker `agents-manager-storage-staging` has no public endpoint.
- Release: source `511cae1ff0a23b6d606c3eebb07a06b840782ace` (deployed 2026-11-03). See [stage-2-deployment.md](stage-2-deployment.md). The hosted import, backup and auth checks of 2026-11-10 are recorded against the Workers in [stage-2-cutover.md](stage-2-cutover.md). A final release SHA for a matching-revision smoke has not been recorded.
- Credential ownership: Cloudflare account and Worker secrets (`AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `MANAGER_SERVICE_TOKEN`, `MANAGER_MIGRATION_TOKEN`) are held by the owner `elisealcala` (GitHub ID `16949569`) in the hosting secret store. Only names were verified; values are not recorded.

## Gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| Signed-out and boundary denial | Passed (2026-11-05) | [stage-2-boundary.md](stage-2-boundary.md) |
| Owner sign-in, sign-out, second-account denial, mutation across re-authentication | Passed (2026-11-10); natural session expiry not observed | [stage-2-auth-browser.md](stage-2-auth-browser.md) |
| Paired import and comparison | Passed (2026-11-10); web import still enabled and migration secrets not removed (#110 open) | [stage-2-cutover.md](stage-2-cutover.md) |
| Scheduled backup and owner download | Passed with gaps: browser was open, failure/retry and non-owner download not exercised (#111 open) | [stage-2-backups.md](stage-2-backups.md) |
| Isolated restore drill, RPO/RTO | **Not performed** (#112 open) | [stage-2-restore.md](stage-2-restore.md) |
| Degraded setup | Partial: outage copy still mentions a local manager (#113 open) | [stage-2-setup.md](stage-2-setup.md) |
| Spending limit / alerting | Owner chose free allowance, no limit or alert | [stage-2-r2.md](stage-2-r2.md) |

## Measured recovery timings

None. No hosted restore drill has run, so actual RPO, RTO and the compatible rollback revision are unrecorded. Only the time to first backup is known: the alarm wrote it on 2026-11-10 at 15:54:58Z after the import.

## Remaining disabled capabilities

Model, intake and search remain unavailable; no delivery adapters are registered; GitHub Projects/repository integration is not connected (Stage 3).

## Decision

Open follow-ups: #110 (disable import, remove migration tokens), #111 (failure and non-owner backup checks), #112 (restore drill), #113 (outage copy). Close #22 and start #29 only after these pass and a final browser smoke runs on the same reviewed release.
