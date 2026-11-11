# Stage 2 hosted backup evidence (GH-111)

Status: **first scheduled backup and owner download recorded on 2026-11-10.** A visible backup failure was not induced, and a non-owner download was not attempted. Issue #111 stays open. Issue #22 stays open.

## Release under test

Same Workers and source SHA as [stage-2-cutover.md](stage-2-cutover.md).

## Scheduled backup

After the import, `GET /api/manager-backup` returned 200, `Cache-Control: private, no-store`:

| Field | Value |
| --- | --- |
| `configured` | true |
| `hasBackup` | true |
| `latest.state` | `ok` |
| `latest.at` | `2026-11-10T15:54:57.978Z` |
| `next` | `2026-11-11T14:54:58.489Z` (23 hours after `latest.at`) |

The R2 list API showed one object, `manager-backups/2026-11-10/1794326097978-de9cc48e-9027-45d7-9be6-a33a66c38d55.json`, 78664 bytes, uploaded `2026-11-10T15:54:58.334Z`. That size matches the prepared pair file. Bucket info still reported `object_count: 0` at 15:57Z; the object list is the authoritative check. The write ran in the Durable Object alarm after the import request armed it. The browser was still open, so this is not a closed-browser wakeup. The next alarm is the 23-hour schedule above.

## Owner download

`GET /api/manager-backup/latest` returned 200, `Cache-Control: private, no-store`, and `Content-Disposition: attachment; filename=manager-backup.json`. The body was not saved in Git. Its manager and evidence snapshot SHA-256 values match the prepared pair, and the table row counts match the cutover note. The page showed “Last verified backup: 11/10/2026, 10:54:57 AM” and a “Download backup” link.

Signed-out `GET /api/manager-backup` and `GET /api/manager-backup/latest` returned 401 with `private, no-store` before this import, recorded in [stage-2-boundary.md](stage-2-boundary.md). A second GitHub account was not used.

## Bucket

`agents-manager-staging-backups` remains Standard in ENAM. Public r2.dev access is disabled and no custom domain is connected. Lifecycle rule `manager-backup-30-days` is enabled and expires only `manager-backups/` after 30 days. The default seven-day incomplete-multipart abort rule remains. No object was deleted.

## Not shown

No hosted backup was forced to fail, so the visible error/retry state was not exercised on this bucket. Local alarm tests remain the failure-path evidence.
