# Active context — studio

## Current focus
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
Configure the documented local manager/classifier processes and measure live models separately. Fixture control results do not establish live or representative-note accuracy.

## Memory
DEC-004 supersedes the prior design-only integration decision. Earlier implementation/scope-correction entries remain historical.
