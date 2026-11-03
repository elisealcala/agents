# Active context — studio

## Current focus

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
Follow the manager's small Stage 2 tickets for OAuth/secrets, cloud binding/deployment, real access checks and hosted import/backup/evidence/recovery acceptance. Do not start original local data owners during cutover. Keep the established local classifier/manager UI boundaries and measure live models separately; fixture control results do not establish live or representative-note accuracy.

## Memory
DEC-004 supersedes the prior design-only integration decision. Earlier implementation/scope-correction entries remain historical.
