# Stage 1 — Contracts, durable state and UI foundation

Status: Planned. Prerequisite: committed system design. Next: [Stage 2](02-private-deployment-and-access.md).

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

These are planning IDs, not existing GitHub issue numbers. Resolve them to real issues in the implementation backlog.

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
