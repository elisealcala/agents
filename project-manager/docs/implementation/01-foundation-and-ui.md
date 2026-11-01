# Stage 1 — Contracts, durable state and UI foundation

Status: Implemented locally; verification and publication are recorded in the project-manager memory bank. Prerequisite: committed system design. Next: [Stage 2](02-private-deployment-and-access.md).

## Outcome

A navigable manager web application and a durable delivery domain exist. The user can move between projects, conversation, work, inbox and activity; existing note review/evidence still work. Unimplemented features are clearly unavailable. This phase is developed locally by implementers, with the first private hosted URL delivered in Stage 2.

## Implementation slices

| Ticket | Owned paths, proposed unless existing | Deliverable and dependency |
| --- | --- | --- |
| PM-101: Delivery contracts | `project-manager/src/delivery/contracts.ts`, `src/server/delivery-router.ts` | Define repo/work/decision/observation/job/outbox/QA/notification contracts, discriminated provenance and explicit IDs. First slice. |
| PM-102: Durable store and migration | `src/storage/delivery-store.ts`, `src/storage/migrations/`, existing `store.ts` | Versioned relational delivery tables alongside legacy state; one DB owner, optimistic revisions, durable action intent and lease/attempt fields. Depends on PM-101. |
| PM-103: Reducer and job skeleton | `src/delivery/{reducer,jobs,outbox,policies}.ts`, existing server bootstrap | Typed transitions and fake-adapter job execution; interrupted delivery work reconciles rather than being indiscriminately failed by legacy Store startup. Depends on PM-102. |
| PM-104: Manager UI shell | `studio/app/manager/`, `studio/components/manager/{shell,project-switcher,status-state}.tsx` | Navigation, explicit portfolio scope, responsive/accessible states and capability flags using clearly labelled preview fixtures, then read-only real state. Depends on PM-101; integrate PM-102/103 before exit. |
| PM-105: Legacy compatibility | Existing manager workspace/client/router and shared evidence panels | Preserve current review, conversations, source inspection and traces as tools within the new UI; no automatic candidate acceptance. Depends on PM-102/104. |

These are planning IDs; the whole stage is tracked by GitHub issue #21.

## Contracts and state

Separate GitHub observations, authenticated human decisions, planner proposals and approved note facts. Store immutable repo IDs plus display names; never use issue number alone as identity. Define fingerprints including PR/head/base/criteria/linked issues/plan/policy/toolchain. Model issue completion separately from verified PR contribution. Use capability states `unconfigured`, `available`, `degraded`, `paused` and `disabled`; incomplete setup is not an application crash.

PM-103 may use provider doubles to prove transitions but cannot claim GitHub writes or operational autonomy. Reuse the existing bounded model interface without choosing an implicit new model default. Keep the original intake/question recovery behavior distinct from delivery lease recovery.

## Browser acceptance

Navigate the new manager shell by keyboard at desktop/mobile widths; select each repo or explicit portfolio; refresh without losing saved project state; inspect an existing approved fact/source; see a readable empty inbox and unavailable QA capability. Preview data is visibly labelled and never mixed into real progress. Unknown/offline state shows its timestamp and next action.

## Verification and exit gate

- Migration/restart tests preserve current projects, evidence references and pending reviews; a second owner is rejected.
- Revision conflicts and invalid repo IDs cannot mutate unrelated work. State-plus-outbox commit is atomic locally.
- Expired attempts cannot complete a newer lease; simulated unknown effects remain unresolved until reconciliation.
- Manager typecheck/lint/scoped tests and Studio typecheck/lint/build pass; browser navigation and legacy evidence flow pass.

Exit: a real UI shell is integrated with durable state and legacy flows. No public deployment or GitHub mutation is enabled. Rollback: restore the pre-migration snapshot using the documented compatibility boundary; retain operation records needed to reconcile any later effects.

## Implemented boundary

The manager stores local references to the two selected repositories using stable GitHub numeric IDs. Saving a reference does not install or authorize a GitHub App, import issues, or establish a live connection. The Studio notes project remains independently selected and is not automatically associated with a repository. GitHub connection and inventory remain Stage 3 work.

The scheduler starts with no registered external adapters. It can run explicitly injected fake adapters in tests, fences stale attempts, and marks timed-out or interrupted effects for reconciliation. Abort signals are cooperative: a future real adapter must honor cancellation or use enforced isolation, and an unknown effect must be reconciled before retry. No remote mutation or automatic QA/merging is enabled in Stage 1. See [migration and recovery](../operations/stage-1-migration.md).
