# Stage 2 boundary evidence (GH-108)

Status: **hosted boundary checks recorded on 2026-11-05.** No data was imported and no backup was downloaded. Stage 2 #22 stays open.

Checked 2026-11-05 15:05–15:22 UTC against the Workers still serving the #107 release.

## Release under test

| Item | Value |
| --- | --- |
| Source SHA | `511cae1ff0a23b6d606c3eebb07a06b840782ace` |
| Web Worker `project-manager` | version `386908ec-ff2a-4041-b63e-2182bd0d2aa2`, created 2026-11-03 18:23:31 UTC, 100% |
| Storage Worker `agents-manager-storage-staging` | version `92bbd4ab-c860-48c2-bf4f-e0634554a797`, created 2026-11-03 18:22:56 UTC, 100% |
| Web origin | `https://project-manager.ezth.workers.dev` |
| Wrangler | 4.154.0 |

Versions were read with `wrangler deployments status`. Secret values were not read.

## Signed-out and forged-header HTTP

All of these returned `Cache-Control: private, no-store`. Bodies were the generic JSON errors (`Sign in required.`, `Backup status unavailable.`, or `Backup is unavailable.`) and matched none of `localhost`, `127.0.0.1`, stack traces, `AUTH_SECRET`, `AUTH_GITHUB_SECRET`, `MANAGER_SERVICE_TOKEN`, or `MANAGER_MIGRATION_TOKEN`.

| Check | Result |
| --- | --- |
| `GET /api/manager/projects.list` | 401 |
| `GET /api/manager/projects` | 401 |
| `GET /api/manager-backup` | 401 |
| `GET /api/manager-backup/latest` | 401 |
| `POST /api/manager-migration` with the site origin, `https://evil.example`, and `null` | 401 each |
| `POST /api/manager/projects.create` with those same three origins | 401 each |
| The reads above, plus `POST /api/manager-migration`, with forged `authorization`, `x-manager-actor`, `x-manager-owner-id`, `x-manager-service-token`, `x-manager-target`, and `x-forwarded-host` | 401 |

Signed-out denial happens before the origin check, so these 401s do not prove an authenticated cross-origin mutation is rejected. `/api/auth/session` returned `null`. `/` redirected to `/manager` and `/manager` redirected to `/login`.

## Direct storage endpoint

`https://agents-manager-storage-staging.ezth.workers.dev` returned HTTP 404 for `GET` and `POST` of `/`, `/backup/status`, `/migration/import`, and `/trpc/projects.list`, including with forged actor and authorization headers. Each body is Cloudflare's standard error page (19984 bytes of HTML), not manager JSON. The manual spec repeated those eight requests and passed. `workers_dev` remains false in the storage config. This shows the public workers.dev hostname is not the private Durable Object. It does not show what an in-account binding caller can do.

## Signed-out page, assets, and screenshot

The login page rendered “Project manager”, “Sign in with the authorized GitHub account.”, and “Sign in with GitHub”. Its resource timing listed only same-origin `/_next/static` CSS, JS, and font files. No request targeted localhost or the storage Worker.

Twenty login-page assets were scanned. The only `localhost` match is the URL parser inside `/_next/static/chunks/polyfills-42372ed130431b0a.js` (`"localhost"===s.host`). No asset contained `AUTH_SECRET`, `AUTH_GITHUB_SECRET`, `MANAGER_SERVICE_TOKEN`, `MANAGER_MIGRATION_TOKEN`, `agents-manager-storage-staging`, `manager.internal`, `8788`, or `8789`. Static assets use `public, max-age=0, must-revalidate`; the login document uses `private, no-store`. The signed-out screenshot shows only the sign-in prompt. The signed-in manager page is recorded in the owner section below.

## Owner session — 2026-11-05 15:20 UTC

The owner signed in through GitHub. The browser landed on `https://project-manager.ezth.workers.dev/manager`. The session cookie was not read or recorded. Requests were made from the page with `credentials: include`.

| Check | Result |
| --- | --- |
| `GET /api/manager-backup` | 200, `Cache-Control: private, no-store`. Body keys were `configured`, `hasBackup`, `latest`, and `next`. `configured` was true, `hasBackup` was false, and `latest` was null. |
| Same request with forged `authorization`, `x-manager-actor`, `x-manager-owner-id`, `x-manager-service-token`, `x-manager-target`, and `x-forwarded-host` | 200 with the same shape and `private, no-store`. The forged client headers did not change the result. |
| `GET /api/manager/projects.list`, with and without those forged headers | 503, `private, no-store`, body `{"error":"Manager is unavailable. Try again."}`. |

The backup status is returned only after the same-origin route reads the private Durable Object. That 200 is the binding proof. The project-list 503 is the generic unavailable response; it matches the required import lock and does not by itself prove which backend failure occurred. No project data was returned.

The signed-in page showed “A backup is not scheduled.”, “Sign out”, and “Manager is unavailable.” The unavailable sentence tells the reader to check that the local manager is running. The page did not show a stack trace, a credential, a backup body, or a localhost URL. Resource timing for that page listed 30 responses, all on `https://project-manager.ezth.workers.dev`. Five manager chunks that were not on the login page were scanned (`442`, `228`, `823`, `app/manager/layout`, `app/manager/page`): no `localhost`, `127.0.0.1`, secret names, storage Worker name, `manager.internal`, or ports 8788/8789.

## Cross-origin mutation

A sandboxed opaque-origin `POST` of `{}` to `/api/manager-migration` was blocked by the browser (`Failed to fetch`) before a response status could be read. A top-level form `POST` of the same invalid body from `https://example.com` navigated to the endpoint and rendered `{"error":"Sign in required."}`. The session cookie was not attached to that cross-site request, so this 401 does not exercise the authenticated origin branch. It does show the cross-site mutation was rejected and was not imported. No same-origin import `POST` was sent.

A second GitHub account was not used. Forged actor headers are the wrong-actor control this boundary implements.

## Result

Unsigned, forged-header, and direct storage attempts cannot read or mutate manager state. The signed-in same-origin backup request reaches the private binding and ignores forged identity and target headers. Protected API responses used `private, no-store`. The inspected login and manager assets, network list, and screenshots did not expose credentials, private backup contents, raw exceptions, or localhost targets. #108 is complete for this boundary. Import, a real non-owner GitHub account, and the rest of Stage 2 remain open under #22.
