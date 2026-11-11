# Active context — studio

## Current focus

Issue #109 (2026-11-10): corrected the manual hosted acceptance spec from the open `pm-201` PR in `tests/manager/stage-2-auth.spec.ts`. It pins cookie-bearing requests to the canonical HTTPS staging origin, checks the immutable owner ID, separates previously verified expired-token replay from sign-out, and requires elapsed expiry plus operator-supplied provenance before replay. Non-owner OAuth denial, natural browser expiry and mutation replay remain browser-evidence requirements; arbitrary cookies cannot establish them. Callback checks now require an explicit same-origin OAuth error redirect and no session cookie, with request details redacted on failure. Focused local verification passed one configuration-guard test, five malformed/premature-input rejection cases, Biome checks and a standalone strict TypeScript check; all five hosted checks skipped without live inputs. No runtime/authentication configuration was changed or live acceptance claimed by this test-editing task.

Independent continuation verification passed `pnpm typecheck`, focused Biome checks and all 51 default Studio tests. The manual auth spec without environment inputs passed one local guard test and skipped five hosted checks; against the canonical hosted origin without cookies it passed three checks and skipped owner, expired-token and authenticated-origin checks. Five malformed/premature input cases were rejected with sentinel cookies redacted. Separately, the parent browser task reports real owner/non-owner OAuth, exactly one local repository reference after refresh/sign-out/re-authentication, and an authenticated sibling-origin form POST rejected with 403. Those browser observations are distinct from this spec's skipped checks; the parent owns their evidence and the pending PR #122 update. Natural browser expiry remains unverified: the reserved owner profile deadline is `2026-11-11T04:33:35.621Z` (23:33:35 Lima on November 10), with the check planned after 23:34 Lima.

Issue #108 (2026-11-05): `tests/manager/stage-2-boundary.spec.ts` passed its signed-out and direct-storage checks against staging. The owner binding proof was made in the signed-in browser, not by supplying `BOUNDARY_OWNER_COOKIE` to that file. Details are in the project-manager evidence file for this issue.

Stage 2 publication verification (2026-11-02): hosted mode has owner-only GitHub session checks, a same-origin allowlisted private manager proxy, a Cloudflare Durable Object binding, guarded paired-backup import and private backup status/download interfaces. Fresh Studio verification passed typecheck, Biome lint/format (50 files), all 51 Node tests and the complete OpenNext Cloudflare/Next.js 16.4.1 Webpack production build. The pending Studio changes inspected are Stage 2 foundations and contain no real credential or private backup contents. The user has authorized publishing the completed work and splitting the remainder into small GitHub tickets; the parent manager task owns publication and ticket references.

These are local source/test/build results. Mocked session/binding tests do not establish real OAuth, deployed cross-script service binding, owner/non-owner/session-expiry access from another device, hosted evidence/import/backup flows, R2 operation or isolated hosted restore. No deployment, real cloud resource creation or live model operation occurred in this verification. Preserve those acceptance gates and explicit disabled capabilities.

Stage 1 of the project-manager work was verified and published in commit `cf37754`; issue #21 is closed. The local `/manager` shell provides portfolio and local repository reference controls, read-only delivery state and the existing notes/review/evidence workspace. Responsive panels stack at mobile widths. GitHub connection, QA and automated delivery are not yet available. Browser checks used synthetic local data; this is not a deployed product.

Memory/source audit completed on 2026-10-28. All five decisions are recorded and align with the inspected scripts, typed clients, optional registry kind, workspace reset and citation/review UI. No new Studio checks, browser flow or build was run for this documentation-only audit.

Clean-checkout CI typechecking is repaired: typecheck now runs `next typegen` before `tsc` (DEC-005). The verifier reproduced the original LayoutProps error and passed the complete check twice in a fresh copy, including after removing generated types and compiler cache.

Verified local UI for classifier and the accuracy-first project-manager pilot. The optional registry kind selects a dedicated manager workspace; omitted kinds preserve classifier navigation and behavior.

On 2026-10-05 the Studio development server responded at `http://localhost:3000`, with registered agent services on ports 8787 and 8788 and dedicated evidence on 8789. These are historical observations; current server availability was not checked in this audit.

## Verified behavior — 2026-10-05
- Types/lint/format and supported Webpack production build pass; the default build's font fetch was restricted by the sandbox.
- Browser flows pass project creation/Markdown intake, review isolation, accept/edit/reject, human confirmations, approved chat and pending clarification.
- Project switching clears local draft/chat/source/trace state. Citations verify immutable project/ref/version/checksum/passage identity.
- Saved evaluation counts/settings are read-only; failure links select the associated project and shared trace viewer.
- Test servers and browser tabs were stopped. User configuration was preserved.

## Next steps
Use the corrected #109 spec only with explicitly supplied real session inputs and the required expiry provenance; the manager task owns the remaining hosted browser evidence and PR disposition. Keep skipped checks incomplete.

Follow the manager's small Stage 2 tickets for OAuth/secrets, cloud binding/deployment, real access checks and hosted import/backup/evidence/recovery acceptance. Do not start original local data owners during cutover. Keep the established local classifier/manager UI boundaries and measure live models separately; fixture control results do not establish live or representative-note accuracy.

## Memory
DEC-004 supersedes the prior design-only integration decision. Earlier implementation/scope-correction entries remain historical.
