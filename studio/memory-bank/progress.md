# Progress — studio

## Status

Current: Local Next.js Studio drives classifier and project-manager through separate typed tRPC clients. Stage 2 hosted authentication, private proxy, import/backup interface and Cloudflare build foundations pass local publication checks; real deployment and OAuth acceptance remain open.
Next: Publish the verified Stage 2 foundations, then complete the manager's small hosted configuration, deployment and acceptance tickets. Measure real-model behavior separately.

## Checklist

- [x] Decide: Next.js client, per-agent tRPC server (`DEC-001`)
- [x] Agent list, ask thread, run actions, trace inspector, settings sheet, memory view
- [x] `pnpm check` and `pnpm build`
- [ ] Live library run from the UI against a real model
- [x] Review-first project-manager workspace, immutable citation inspector and evaluation report viewer
- [x] Verify project-manager integration after implementation finishes
- [x] Verify Stage 2 Studio types, lint/format, 51 route/policy/transport tests and OpenNext production build
- [ ] Verify real hosted OAuth, owner/non-owner/session access and import/backup/evidence browser journeys

## Log

### 2026-11-02 — Stage 2 private Cloudflare interface

- Added hosted owner authentication, a restricted same-origin proxy, private manager binding and OpenNext Cloudflare build configuration. Synthetic local checks covered session access decisions and private response headers; real OAuth, deployment and the latest binding integration still need verification.

### 2026-10-01

- Scaffolded the Next.js app with shadcn/ui.
- The workspace calls the classifier router for runs, config, corrections, memory, and the live trace subscription.
- Settings and traces stay in the library database owned by `ingest-classifier`.

### 2026-10-01 — Ask reply and font

- The chat was keeping the first fetch of a run, which was still `running`, so the reply never appeared even after the trace finished. It now refetches until the run ends and also reads the finished `ask_question` span. The question is shown above the reply.
- `--font-sans` pointed at itself, so the page used the browser default. It now uses Geist.

### 2026-10-01 — Project manager workspace
- Registered the independent project-manager server and added a typed workspace for project creation, intake retries, cited reports, conversation history and shared trace inspection.
- Classifier workspace stays on its existing router.

- Verifier passed Studio types/lint/format and `pnpm build --webpack`; default Turbopack hit an environment PostCSS port-binding EPERM. The manager HTTP flow passed using fake ports. Real browser/model use remains pending.

### 2026-10-01 — Scope correction
- User clarified system design only. Removed the project-manager workspace, registry entry and package dependency introduced in the previous task; restored pre-task Studio source/configuration. Earlier implementation entries are historical and do not describe current state.

### 2026-10-05 — Accuracy-first project-manager implementation
- Added a separate typed project-manager workspace and backwards-compatible registry kind. Classifier workspace remains on its original client and controls.
- Added project creation/selection, Markdown intake with stable submission identity, storage/index status and same-note retries, review with revision guards, approved state/history, persisted conversations and exact citation inspection.
- Reused the shared trace inspector and added read-only evaluation counts, gates, model/dataset versions, settings and case failures.
- Updated setup documentation and recorded DEC-004. Implementation is complete; dependency refresh and verifier checks are pending with the parent task.

### 2026-10-05 — Integration verification
- Verifier passed types/lint/format and the supported Webpack production build. Default build font fetching encountered sandbox network restrictions.
- Browser integration passed project creation/notes, accept/edit/reject, human confirmation provenance, approved chat/pending clarification, project switching, exact citation inspection, saved evaluation counts and failure-to-trace navigation.
- Batched repairs added explicit form label associations, stable keys and complete citation identity/version checks. Owned test servers/tabs were cleaned up; no live model calls or user configuration changes.

### 2026-10-05 — Local Studio session
- Started the Studio development server at `http://localhost:3000` and confirmed the home page responds successfully.
- Confirmed the same Studio process remains available alongside classifier port 8787, manager port 8788 and dedicated project-evidence classifier port 8789. All agent identity endpoints returned successfully.

### 2026-10-05 — Clean-checkout CI type generation
- CI reported TS2304 for LayoutProps because checks run before Next.js has generated framework types. Local cached dev/build types masked the failure.
- Updated the typecheck script to run next typegen before tsc, following the installed Next.js CLI documentation. Added README guidance and DEC-005.
- Verifier reproduced the original LayoutProps failure with the old command. Updated pnpm check passed twice in a fresh temporary copy, including after deleting generated types and compiler cache: typecheck, lint and format all passed. All 25 dependency specifiers match the lockfile; git diff --check passed.
- Generated routes.d.ts contains global LayoutProps and next-env.d.ts imports the generated types. The running Studio and its generated files were untouched; temporary verification files were removed. Unrelated publication notes remain outside this fix.

### 2026-10-28 — Memory-bank accuracy audit

- Compared all five recorded decisions with `package.json`, `lib/registry.ts`, both typed tRPC clients, agent routing and project workspace/panel code. Independent process boundaries, optional-kind compatibility, `next typegen` before `tsc`, keyed project resets and citation identity checks are present.
- Refreshed active context to distinguish dated verification/server observations from current source inspection. Original dated history and superseded design-only decisions are retained.
- No missing major Studio architecture decision was identified in the inspected paths. This is static documentation verification, not a fresh build/browser test or proof that every prior chat-only decision was saved. No runtime code, user registry, server state or project data changed.

### 2026-11-01 — Manager foundation in progress

- Added a local `/manager` shell with navigation, real read-only manager queries, labelled unconnected scopes, unavailable states and an entry to the existing notes, review, conversation and source panels. Scope selection survives browser refresh.
- Tested the shell in a browser using a synthetic project and human confirmation, including exact source verification; adjusted the review/source panels to stack on a narrow viewport. Manager delivery and GitHub connection work remains incomplete, and the shell is not deployed.
- Verification: Studio checks and a Webpack production build passed; browser checks also covered scope selection across refresh, offline state and a synthetic human-confirmation source. Further automated browser and Stage 1 acceptance coverage remains open.

### 2026-11-01 — Stage 1 local repository references

- Added controls to save the two verified repository IDs as local references, with explicit wording that GitHub is not connected or imported. Clarified that legacy notes projects are independently selected from repository scope.
- In an isolated browser session, saved both references, refreshed the selected scope, and navigated by keyboard at desktop and mobile widths. Final verification and publication belong to the Stage 1 manager task.
- Final verifier passed Studio typecheck, lint, format and Webpack production build; full manager suite passed 132 tests. Browser results above used isolated test data.

- Published the Stage 1 Studio work in commit `cf37754`; the manager issue #21 is closed.

### 2026-11-02 — Stage 2 publication verification

- User requested committing/pushing completed Stage 2 work and splitting the remaining work into small tickets. Inspected pending Studio auth, same-origin allowlist/actor/origin checks, hosted-mode guards, private Durable Object transport, backup import/status/download routes, UI, build configuration and dependency lockfile. All pending Studio paths are related to Stage 2; no unrelated source changes or real credential/private backup contents were found in the inspected publication candidates.
- Fresh verification passed in order: `pnpm typecheck`; `pnpm lint` and `pnpm format:check` (50 files each); all 51 Node route/policy/payload/transport tests; then `pnpm cloudflare:build`, including the Next.js 16.4.1 Webpack production build and OpenNext worker generation. Build artifacts remain ignored; no source code was changed by this verification task.
- Route tests use mocked sessions and private bindings. This check did not prove real GitHub OAuth, an externally deployed cross-script binding, another-device/non-owner/session-expiry browser access, hosted paired import, R2 backup/download or isolated restore. Those remain acceptance/configuration tickets; unavailable model/intake capabilities must remain explicit. No deployment, cloud resources, original local services or live model calls occurred.
- Refreshed only this component's progress and active context. Publication Git references and the remainder issue numbers belong to the parent manager task.
