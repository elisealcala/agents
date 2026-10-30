# Stage 5 — PR intake and independent QA

Status: Planned. Depends on [Stage 4](04-conversations-planning-and-tickets.md), deployed connections and isolated runner capacity. Next: [Stage 6](06-reviews-merges-and-progress.md).

## Outcome

The manager detects a linked PR with evidence, runs independent verification and shows understandable results in the UI. The user can inspect what passed, what failed and what was not verified. Automatic merging stays disabled throughout this stage.

## Implementation slices

| Ticket | Owned paths, proposed unless existing | Deliverable and dependency |
| --- | --- | --- |
| PM-501: PR binding/evidence intake | Pull adapter, `src/qa/contracts.ts`, delivery state | Explicit issue/contribution links, author evidence manifest, exact repo/PR/head/base/criteria/plan/policy/toolchain fingerprint; draft/unlinked handling. |
| PM-502: Trusted supervisor and isolation | `project-manager/qa-runner/`, `src/qa/{runner-client,profiles}.ts`, job-scoped callbacks | Provision disposable VM/microVM, immutable commit identity with writable build workspace, no control credentials/mounts/socket, resource limits and trusted result envelope. Depends on PM-501. |
| PM-503: QA plans and reports | `src/qa/{coordinator,reports}.ts`, trusted acceptance probes/profiles | Verify declared contribution, assess remaining whole-ticket criteria, independent checks/findings, commands/exits and hashed artifacts; pass/changes/inconclusive/infra states. Depends on PM-502. |
| PM-504: Browser QA workspace | `studio/app/manager/pull-requests/[bindingId]/`, `components/manager/{qa-summary,criteria-coverage,findings,artifacts}.tsx` | Current/historical assessment, progress, actionable findings, logs/screenshots, missing capability and retry/cancel where allowed. Depends on PM-503. |
| PM-505: Seeded-defect/correction exercise | Isolated PR fixtures, runner/provider contract tests and browser journeys | Independently test a known defect, correction, unavailable verification, stale head/base and self-policy changes for both repo profiles. |

## Trust and coverage

The QA reasoning role has separate instructions from implementation and receives requirements plus evidence, not an inherited “it passed” conclusion. The external supervisor owns execution attestations; candidate code can upload artifacts but cannot sign an authoritative pass or publish checks. Run trusted baseline/acceptance probes outside the candidate checkout; inspect weakened/removed tests. No skipped mandatory criterion counts as success.

Version results across linked issues, declared contributions and integration base. A verified partial PR can be eligible for later merging without completing an entire ticket. A new commit/criteria/plan/policy/environment change supersedes old QA. Reuse unaffected evidence only under explicit validated policy; default conservatively to current verification.

`chore-design` and relevant `agents` components receive verified execution profiles based on their actual package contracts during implementation. Do not invent current commands from memory. A collection ticket names the specific component/bank boundary. A manager self-update is tested under the trusted deployed controller/profile; it cannot relax its own gate or deploy itself through QA.

## Browser acceptance

Deliver a PR from Codex with the ticket link and evidence. The UI shows queued/running QA, criteria coverage and findings. Open a reproducible defect and screenshot/log evidence, fix through Codex, push a new commit and see prior QA marked historical. If the runner lacks a required environment, see an inconclusive result and the precise missing prerequisite, not an approval.

## Verification and exit gate

- Demonstrate actual isolated execution, credential/network separation, signed job/attempt validation and resource cleanup.
- Defective and corrected candidate behavior is independently reproduced; unrelated or forged artifacts/checks cannot satisfy coverage.
- Head/base/criteria/fingerprint races, late callbacks and restart/cancellation are tested through real components.
- UI/browser evidence and accessibility journeys pass. Measure seeded defect detection and unsupported passes separately from transport success.

Exit: independent QA reports are trustworthy enough for the subsequent review/merge integration gate. No claim of perfect defect detection. Rollback: stop runner dispatch, invalidate in-flight leases and retain immutable reports; user/Codex continue code corrections without automatic merges.
