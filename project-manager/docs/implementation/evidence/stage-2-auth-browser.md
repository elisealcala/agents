# Stage 2 owner sign-in evidence (GH-109)

Status: **owner sign-in, sign-out, unsigned callback, real second-account denial, authenticated origin rejection, and one mutation across refresh/re-authentication recorded on 2026-11-10.** Natural expiry remains unverified. Issue #109 stays open. Issue #22 stays open.

## Release under test

Same release as [stage-2-deployment.md](stage-2-deployment.md): source `511cae1ff0a23b6d606c3eebb07a06b840782ace`, web Worker version `386908ec-ff2a-4041-b63e-2182bd0d2aa2`, storage Worker version `92bbd4ab-c860-48c2-bf4f-e0634554a797`, canonical origin `https://project-manager.ezth.workers.dev`. Both versions were rechecked during this session. Session lifetime in source is a JWT `maxAge` of 8 hours (`studio/auth.ts`). No session cookie, CSRF token, or OAuth secret was recorded.

## Owner

The browser already had a GitHub session for `elisealcala`. Sign-in returned to `https://project-manager.ezth.workers.dev/manager`. `GET /api/auth/session` returned 200 with user id `16949569` and `Cache-Control: private, no-store`. `GET /manager` returned 200 with the same cache header. The HTML did not contain `AUTH_SECRET`, `AUTH_GITHUB_SECRET`, `MANAGER_SERVICE_TOKEN`, or `MANAGER_MIGRATION_TOKEN`.

Sign-out returned to `/login`. After sign-out, `/api/auth/session` had no user. `GET /api/manager/projects.list` returned 401 `Sign in required.` `GET /api/manager-backup` returned 401 `Backup status unavailable.` `GET /api/manager-backup/latest` returned 401 `Backup is unavailable.` `POST /api/manager/projects.create` from this page returned 401. Each of those responses used `private, no-store`. A later owner sign-in reached `/manager` again.

`GET /manager` with no cookie returned 307 to `/login` with `private, no-store`.

## Callback

`GET /api/auth/callback/github` and the same path with `code=not-a-code&state=bad` each returned 302 to `/api/auth/error?error=Configuration` with `private, no-store`. Neither request created a session. The error URL itself returned 403 and set HttpOnly CSRF and callback cookies. Those cookie values are not recorded here.

## Limits of the earlier checks

The GitHub account switcher in this browser listed only `elisealcala`, plus “Add account”. No other GitHub identity signed in, so owner-only denial is not yet a live result. An 8-hour-old valid session was not available, so expiry was not observed. Refresh of the same import is recorded in the cutover note; no other mutation was repeated.

## Follow-up session — 2026-11-10, 20:32–20:34 UTC

Cloudflare deployment readback still reports 100% web version `386908ec-ff2a-4041-b63e-2182bd0d2aa2` and storage version `92bbd4ab-c860-48c2-bf4f-e0634554a797`. No deployment or authentication setting changed.

In Chrome's `elizabeth` profile, direct navigation to `/manager` first returned to `/login`. Clicking **Sign in with GitHub** returned to `/manager`. The session document reported owner ID `16949569` and expiry `2026-11-11T04:33:35.621Z` (2026-11-10 23:33:35 in Lima). Only the ID and expiry were retained; no cookie or other session fields were copied. The test tab was navigated to `about:blank` immediately afterward. This starts an idle-session expiry check; it is not evidence that expiry has passed.

The existing hosted boundary spec was rerun without session-cookie inputs: four checks passed (signed-out reads, signed-out mutations, forged identity headers, direct storage endpoints), zero failed, and the two owner-cookie checks skipped. These skips do not prove authenticated origin rejection.

For the expiry continuation, leave this profile's manager session untouched until after 23:34 Lima on 2026-11-10. Before signing in again, check the session document has no user, `/manager` returns to `/login`, and the protected manager and backup APIs deny access. Then re-authenticate and verify return to the manager. Opening the session endpoint before the deadline refreshes the JWT and moves the deadline; signing out or deleting a cookie would test a different condition. Browser expiry alone does not establish rejection of an expired token deliberately replayed by a client.

A separate Chrome profile (`Your Chrome`) was used for the second real GitHub identity so it did not replace the owner session reserved above. Its completed OAuth journey is recorded below. At this point the successful-mutation refresh/re-authentication journey had not been checked; the later local-reference check below supplies that result. The earlier repeated import does not cover that journey.

## Real second-account denial — 2026-11-10, 20:43–20:45 UTC

The owner signed in a different actual GitHub account in the separate profile. GitHub's account selector showed that identity separately from `elisealcala`. After the user explicitly approved the displayed read-only profile/email permissions in this chat, **Authorize elisealcala** was selected on the Project Manager Staging consent screen. GitHub displayed “OAuth application authorized” and redirected through the configured application callback. The application landed on `/api/auth/error?error=AccessDenied` and displayed “Access Denied” and “You do not have permission to sign in.” The denial page was visually inspected in a screenshot. No OAuth code, token, email address or session cookie is included in this evidence.

In that same browser profile, the session document had no user. Direct `/manager` navigation returned to `/login`. Direct browser navigation to the protected endpoints displayed these complete denial bodies:

| Endpoint | Visible response |
| --- | --- |
| `/api/manager/projects.list` | `{"error":"Sign in required."}` |
| `/api/manager-backup` | `{"error":"Backup status unavailable."}` |
| `/api/manager-backup/latest` | `{"error":"Backup is unavailable."}` |

No private manager or backup contents were displayed. HTTP status codes and cache headers were not captured for these browser navigations; earlier signed-out HTTP checks separately cover 401/private-no-store behavior. The browser's extension blocked the final return navigation after these three denial responses were read; the denial results themselves had already been observed. The owner profile reserved for natural expiry was not used during this continuation.

The real non-owner sign-in gate now passes. No mutation was submitted in this second-account check. Later origin and mutation checks are recorded below.

## Mutation across refresh and re-authentication — 2026-11-10, 20:49–20:51 UTC

Used a new owner OAuth session in the `Your Chrome` profile, leaving the reserved `elizabeth` profile untouched. The manager initially had no saved repository references. In **Projects**, clicked **Save agents reference** once and immediately refreshed. The returned Projects view showed one `elisealcala/agents` entry and a disabled save button. This creates only the intended local reference; it grants no GitHub connection or repository access.

Signed out to `/login`, signed back in through GitHub as `elisealcala`, and returned to `/manager`. The overview still reported one saved repository and one notes project. Direct navigation to `/api/manager/delivery.repositories` returned exactly one record: GitHub repository ID `1355217430`, owner `elisealcala`, name `agents`, revision `0`, status `ready`. No duplicate reference appeared. No note, project, review decision, import, outbox action or connected repository was created. The reference remains saved as the result of this authorized acceptance check.

This verifies one actual save across refresh and explicit sign-out/re-authentication. It does not claim arbitrary mutations are idempotent, a forced network failure occurred, or an expired session was tested.

## Authenticated origin rejection — 2026-11-10, 20:55–20:59 UTC

With that second owner session still active, opened the storage Worker's public hostname, `https://agents-manager-storage-staging.ezth.workers.dev/`, which serves only Cloudflare's 404 page. Created a transient form in that browser document through DevTools. The form targeted `POST https://project-manager.ezth.workers.dev/api/manager-migration` with `enctype=text/plain` and only the harmless field `probe=origin-check`; it contained no backup. No deployed page or Worker was changed. The user completed Chrome's console-paste handoff before the helper ran.

The browser supplied its real session cookie and the different initiating origin. The application displayed `{"error":"Request origin is not allowed."}`. DevTools reported `POST .../api/manager-migration 403 (Forbidden)`, and the navigation timing entry independently reported response status `403`. In the deployed route, this exact response occurs after owner authentication and before body forwarding; this reaches the authenticated origin check. A subsequent same-profile `/api/manager-backup` read returned `configured: true`, `hasBackup: true`, and no error, confirming the owner session remained usable. No cookie value was copied or printed. Cache headers for this POST were not separately captured in the browser.

The form was submitted twice while obtaining the status evidence; both responses displayed the same origin error. Neither contained a valid import body or reached the import binding. The existing reference count remained one in the earlier post-reauthentication read. The reserved owner profile was not touched.

## Remaining gate

After 23:34 Lima on 2026-11-10, use the reserved `elizabeth` profile to check natural expiry before signing in again. Confirm no session user, direct HTML/API denial, and successful owner re-authentication. Do not close #109 or merge existing PR #122 until this result and required PR verification are recorded. The optional expired-token replay check in the spec is separate from browser-cookie expiry and must not use sign-out as a substitute.
