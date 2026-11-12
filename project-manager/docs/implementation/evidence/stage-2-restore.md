# Stage 2 isolated hosted restore and rollback evidence (GH-112)

Status: **drill NOT yet performed.** No hosted restore, restart or rollback result is recorded here. A local synthetic restore is not a hosted recovery result. Issue #112 and #22 stay open.

Procedure: [stage-2-recovery.md](../stage-2-recovery.md). Record only non-sensitive summaries; never commit backups, cookies, tokens or generated artifacts.

## Isolation (R1)

| Item | Drill value | Distinct from active? |
| --- | --- | --- |
| Storage Worker name | _pending_ | |
| Web Worker name | _pending_ | |
| Durable Object namespaces | _pending_ | |
| Secrets / OAuth callback / test origin | _pending_ | |
| Backup bucket | _pending_ (must not be `agents-manager-staging-backups` active objects) | |
| Original complete backups preserved | _pending_ | |

## Verification after restore and restart (R2)

| Check | Source | Restored | Result |
| --- | --- | --- | --- |
| Snapshot SHA-256 (manager / evidence) | _pending_ | _pending_ | |
| Note / evidence checksums | _pending_ | _pending_ | |
| Review decisions | _pending_ | _pending_ | |
| Job state and counts | _pending_ | _pending_ | |
| Alarm reinitialized after restart | | | |
| Import/lock marker state after restart | | | |

## Recovery measurements (R3)

| Field | Value |
| --- | --- |
| Backup timestamp used / drill start | _pending_ |
| Actual RPO (backup time to latest source change) | _pending_ |
| Actual RTO (drill start to verified) | _pending_ |
| Compatible revision (SHA) and rollback result | _pending_ |
| Limits | Hosted only; DO point-in-time recovery and R2 retention differ in scope |
| Effects reconciled / drill resources identified and removed | _pending_ |
