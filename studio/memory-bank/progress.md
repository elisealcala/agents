# Progress — studio

## Status

Current: Local Next.js Studio drives classifier and project-manager through separate typed tRPC clients.
Next: Configure the live local pilot and measure real-model behavior separately.

## Checklist

- [x] Decide: Next.js client, per-agent tRPC server (`DEC-001`)
- [x] Agent list, ask thread, run actions, trace inspector, settings sheet, memory view
- [x] `pnpm check` and `pnpm build`
- [ ] Live library run from the UI against a real model
- [x] Review-first project-manager workspace, immutable citation inspector and evaluation report viewer
- [x] Verify project-manager integration after implementation finishes

## Log

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
