# Stage 6 — Reviews, protected merging and progress

Status: Planned. Depends on [Stage 5](05-independent-qa.md) and verified real review/branch-rule capabilities. Next: [Stage 7](07-proactive-operation.md).

## Outcome

QA findings become actionable GitHub comments/change requests/approvals. After user/Codex corrections, the manager merges only an eligible current version, updates progress accurately and prepares the next ready work. The UI explains both completed and pending actions.

This stage enables controlled staging/pilot merge exercises with the user present. Unattended production merge dispatch remains disabled until Stage 7 verifies attention delivery, operational budgets and health monitoring and Stage 8 passes the actual quality/release gate. Earlier capability toggles are test-scoped, not an assertion of production readiness.

## Implementation slices

| Ticket | Owned paths, proposed unless existing | Deliverable and dependency |
| --- | --- | --- |
| PM-601: Formal review publication | `src/delivery/reviews.ts`, GitHub review adapter/outbox | Version-bound summary/inline findings with verified coordinates, eligible bot identity and deduplicated unknown-outcome reconciliation. |
| PM-602: Merge eligibility | `src/delivery/merge.ts`, policy/binding state, repo settings UI | Current fingerprint/contribution, required checks/reviews, expected-source rules, strict base handling, open/non-draft state, dependencies and pause/delegation checks. Depends on PM-601. |
| PM-603: Conditional merge and recovery | Merge adapter, job/outbox reconciler | Expected-head merge, no bypass, persisted dispatch/control revision, unknown response recovery and confirmed merge SHA. Depends on PM-602. |
| PM-604: Progress reconciliation | `src/delivery/completion.ts`, criteria coverage store, GitHub Project/issue adapter | Many-to-many PR/ticket coverage; partial work remains open, fully integrated tickets close, dependents advance at their declared milestone. Depends on PM-603. |
| PM-605: Delivery controls and browser acceptance | QA/work/settings/activity UI, isolated GitHub integration tests | Pause/resume, merge-disabled reason, change-request loop, confirmed merge/board-sync state and controlled end-to-end test. |

## Required merge policy

Use distinct eligible reviewer identity; API acceptance of a review does not prove it satisfies branch rules. Verify strict required checks, trusted App check source, required reviews/conversation resolution and no bypass for the configured actor. Initially support normal protected-branch merges; unsupported merge queues/stacked modes stay disabled with an explicit capability reason.

Refresh current state immediately before dispatch under local control revision. GitHub's expected head guard and server rules do not atomically lock external issue edits and chat decisions. Pause stops new dispatches; already accepted remote effects are reconciled honestly. An externally observed late criteria change becomes an auditable follow-up exception, not a false claim of distributed atomicity.

Close only tickets whose entire completion condition has confirmed integrated evidence. A partial PR is allowed when its own declared contribution is verified. Repair accidental premature GitHub closure through a recorded action. Separate `merged` from `Project sync pending`, `released` and `deployed`. Manual external merges without manager QA retain that provenance and may create follow-up work; never fabricate prior approval.

## Browser acceptance

See QA request changes on GitHub and in the app. Give Codex the finding, push the correction, inspect the new approval and current-version checks. Under configured delegation, the manager merges automatically and shows merge SHA, ticket progress and next ready issue. Pause before dispatch to stop the merge; resume to revalidate. If the board update fails after a confirmed merge, see that distinction and retry the projection without re-merging.

## Verification and exit gate

- A real controlled PR exercises request changes → correction → eligible approval → protected merge with evidence on both repo profiles.
- New head/base/criteria/check/review/pause changes cannot reuse stale local eligibility; server conflict/rejection is handled without bypass.
- Lost create/review/merge responses and process restarts reconcile observed effects before retries.
- Partial/final contribution, multi-issue coverage, manually closed/unmerged work, deployment dependencies and board failures have real component tests.

Exit: per-repo controlled pilot merging passes its actual capability/branch-rule gate. Production unattended automation additionally awaits Stages 7–8. Rollback: disable merge dispatch and preserve external-action receipts; reconcile already accepted merges and pending progress writes.
