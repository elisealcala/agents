# Stage 2 auth browser evidence (GH-109)

Status: **incomplete. No live journey has been run for this issue.** Nothing below is a recorded result. Stage 2 #22 stays open.

Missing: a second real GitHub account, a clean-browser session by the owner, and the deployed revision at test time. Absence of the second account is an explicit incomplete gate.

## Prior evidence (not repeated here)

`stage-2-boundary.md` (GH-108) records an owner sign-in landing on `/manager`, signed-out and forged-header denial, and that no real non-owner account was used.

## How to run

1. Record the deployed revision with `wrangler deployments status` (web and storage versions) and the source SHA. Record: ______
2. In a clean browser or another device, sign in as the owner (`elisealcala`, ID `16949569`) and confirm return to `/manager`.
3. In a second clean browser, sign in with another real GitHub account and confirm denial.
4. Copy session cookies without recording them. Run `studio/tests/manager/stage-2-auth.spec.ts` with `AUTH_ORIGIN`, `AUTH_OWNER_COOKIE`, `AUTH_NON_OWNER_COOKIE` and `AUTH_EXPIRED_COOKIE` (the owner cookie after sign-out or expiry). Skipped tests are incomplete.
5. Mutation check: while signed in, start one mutation that is safe and idempotent to count, refresh mid-flight, let the session expire, re-authenticate, and count the resulting records. Exactly one must exist. No import or real data.

## Results (fill in; redact cookies, tokens and account emails)

| Requirement | Check | Result |
| --- | --- | --- |
| R1 | Owner sign-in returns to protected page | not run |
| R1 | Second real GitHub identity denied | not run (no account) |
| R2 | Sign-out denies API and HTML | not run |
| R2 | Expired session denies API and HTML | not run |
| R2 | Signed-out direct HTML/API denied | not run (spec ready) |
| R2 | Callback without valid state; cross-origin authenticated mutation | not run (spec ready) |
| R3 | Refresh/re-authentication creates no duplicate mutation | not run |
| R3 | Redacted screenshots; deployed revision | not recorded |

## Next prerequisite

Provide the second GitHub account, then run the journey above.
