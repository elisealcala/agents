# Stage 2 deployment evidence

Status: **deployment completed; owner-side binding and import-lock smoke pending**, 2026-11-03. Stage 2 #22 remains open; no real data was imported.

## Release

- Source: merged `511cae1ff0a23b6d606c3eebb07a06b840782ace` (the #106 PR), built from a clean checkout. Wrangler 4.154.0 and OpenNext produced the web build; both Worker dry runs passed. The dry-run commands emitted local log-path write warnings, but exited successfully and printed expected bindings.
- Storage first: `agents-manager-storage-staging`, version `92bbd4ab-c860-48c2-bf4f-e0634554a797`, uploaded 2026-11-03 18:22:56 UTC. It has no deployed HTTP targets; `workers_dev` and preview URLs are disabled. Its own `MANAGER` and `EVIDENCE` objects and `BACKUPS` R2 binding point to `agents-manager-staging-backups`. `MANAGER_IMPORT_MODE=required` and `BACKUP_ENABLED=true`.
- Web: `project-manager`, version `386908ec-ff2a-4041-b63e-2182bd0d2aa2`, deployed 2026-11-03 18:23:31 UTC at `https://project-manager.ezth.workers.dev`. The deployed binding listing identifies `MANAGER` as `DurableManagerObject` in `agents-manager-storage-staging`. Import is enabled for the later controlled cutover. No fixture Worker or fixture configuration was deployed.
- Secret-list readback after deployment confirmed the five required web and two storage secret names. This checks names, not credential values or OAuth correctness. The original backup directory remains present; local ports 8788 and 8789 had no listeners before release. Previous Worker versions are empty placeholders, not a compatible prior application release. Keep the original backups and do not start the original owners concurrently.

## Signed-out HTTP smoke

- `/` redirected to `/manager`; `/manager` and `/manager/setup` redirected to `/login`. `GET /api/manager/projects`, `GET /api/manager-backup`, and `POST /api/manager-migration` returned 401; the manager response included `Cache-Control: private, no-store`. `/api/auth/session` returned `null`.
- The storage workers.dev address returned 404. The deployment reported no storage HTTP targets. These checks do not prove owner access or exercise the private binding.
- Independent local verification passed manager typecheck, lint and 14 focused migration/object tests. Source and local synthetic tests enforce the required import marker and fail-closed credential checks. Actual pre-import owner requests across the deployed private binding still require owner-side verification; the setup page alone does not invoke the binding. Missing-credential behavior has not been tested by removing real deployed secrets.

Real OAuth acceptance, cross-origin/forged actor tests, real-data import, hosted backup and restore are separate follow-ups; do not claim them from this evidence.
