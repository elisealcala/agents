# Stage 2 cutover evidence (GH-110)

Status: **hosted import completed and compared on 2026-11-10.** The web import control is still enabled and the migration secrets are still present. Issue #110 stays open until those runbook steps are done. Issue #22 stays open.

Checked against the Workers still serving the #107 release. No second owner was started. Ports 8788 and 8789 had no listeners before the import.

## Release under test

| Item | Value |
| --- | --- |
| Source SHA | `511cae1ff0a23b6d606c3eebb07a06b840782ace` |
| Web Worker `project-manager` | version `386908ec-ff2a-4041-b63e-2182bd0d2aa2` |
| Storage Worker `agents-manager-storage-staging` | version `92bbd4ab-c860-48c2-bf4f-e0634554a797` |
| Web origin | `https://project-manager.ezth.workers.dev` |
| Pair file | `.data/stage2-original-backup-2026-11-02/import.json` (not committed) |

The prepared pair was validated locally before upload. File SHA-256 `5f217316c2c53b23bb60a61629b7dee2e0dbab793e78514ba2cd4c4ac05ed826`, 78664 bytes. Manager snapshot SHA-256 `7d957e0de0da3ebf704a40d41c2aaf74589337f62f4cef47a463448f52fd3e66`. Evidence snapshot SHA-256 `3c457331ddb6c9992a11f55fbd3da5027d2834b3b852364c98ba5e05c2a04f91`. Quiescence check passed: no run had status `running`. Counts were 1 project, 1 note (`review`), 3 runs (`partial`, `success`, `partial`), 0 evaluations, 0 delivery repositories, 0 outbox rows, 0 work items, 0 jobs, 1 evidence document, 1 evidence key, and 4 evidence chunks. The note checksum and the evidence checksum share prefix `287c8196`.

## Import

The signed-in owner posted that pair to `POST /api/manager-migration`. The response was HTTP 200 `{"ok":true}` in about 1.0s, with `Cache-Control: private, no-store`. A second post of the same pair returned the same 200 in about 1.2s. After both posts the manager still showed one project and one `review` note, so the completed import did not apply the pair a second time.

A conflicting pair was not uploaded. The destination already holds this pair, and the runbook says to stop rather than overwrite a conflict. Local migration tests cover the conflict branch. An interrupted live import was not induced.

## Comparison

`GET /api/manager/projects.list` returned 200. The list has one project and one note with status `review` and checksum prefix `287c8196`. `GET /api/manager/delivery.repositories` returned 200 with an empty list. The notes workspace showed project “Agents repository — chat demo” and 12 pending review proposals tied to source version `b9fd369ba3dce70a7110cb1bec5e4eb4998ce75e`. No proposal was accepted, edited, or rejected. The overview showed 0 saved repositories and 1 notes project.

Original SQLite files remain in the ignored backup directory. Their contents were not committed.

## Still open for #110

Disable `MANAGER_IMPORT_ENABLED` on the web Worker and remove `MANAGER_MIGRATION_TOKEN` from both Workers after the remaining Stage 2 checks no longer need a retry. Keep `MANAGER_IMPORT_MODE=required` on the storage Worker.
