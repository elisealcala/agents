# Stage 2 deployed private-boundary evidence

Status: **incomplete**. The owner has one GitHub account, so a real non-owner sign-in remains untested. Stage 2 #22 remains open; no real data has been imported.

## Release under test

- Web version `386908ec-ff2a-4041-b63e-2182bd0d2aa2` at `https://project-manager.ezth.workers.dev`; storage version `92bbd4ab-c860-48c2-bf4f-e0634554a797`; deployed source `511cae1ff0a23b6d606c3eebb07a06b840782ace`. See [deployment evidence](stage-2-deployment.md).
- The deployed storage configuration requires import; the generic pre-import manager error does not independently prove its cause. No real project data was submitted or changed by these checks.

## Checks performed

- Unauthenticated `GET /api/manager/projects.list` returned 401. Supplying forged actor/identity or forged host/target headers still returned 401. An unsigned cross-origin `POST` with invalid input returned 401; this alone does not prove the origin check for an authenticated owner. Direct access to the storage workers.dev address returned 404; the storage Worker has no public HTTP target.
- The owner previously reported signing in and seeing “A backup is not scheduled.” The web backup-status route returns that display only after a successful authenticated status call through the private binding. Before import the manager displayed a generic unavailable error. That is consistent with, but does not independently prove, the import lock or successful project reads.
- The signed-out manager response had `Cache-Control: private, no-store`. This is not yet a complete audit of every protected response.
- Scanned 34 built static HTML/CSS/JS files for the names of server secret variables, the private storage workers.dev address, and common local manager/evidence HTTP targets: no matches. The eight static asset references on the deployed login page matched the scanned local build byte-for-byte. This bounded scan does not establish that every secret value, asset, network request, screenshot or raw error was inspected.

## Remaining

- Run the owner-side `studio/tests/manager/stage-2-boundary.js` check and record its redacted status table. Browser cross-origin failures may be opaque and do not establish the server response; forged headers are not a real non-owner identity. Do not paste cookies, tokens, request bodies or private content.
- Exercise a real non-owner GitHub identity and the complete owner/forged-header, cross-origin, cache and client-exposure acceptance checks. The owner reports that no second GitHub account is available; do not close #108 on an unverified non-owner claim. The import lock also prevents a successful owner project-state read from being established before cutover.
