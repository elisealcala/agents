# Stage 4 — Conversations, priorities and ready tickets

Status: Planned. Depends on [Stage 3](03-github-connections-and-sync.md). Next: [Stage 5](05-independent-qa.md).

## Outcome

The deployed manager becomes useful for daily planning. Ask what is happening, decide priorities, resolve a blocker and get a complete GitHub ticket to give Codex. Routine actions within delegated goals require no repeated confirmations.

## Implementation slices

| Ticket | Owned paths, proposed unless existing | Deliverable and dependency |
| --- | --- | --- |
| PM-401: Contextual status conversations | `src/planning/context.ts`, delivery conversation API, manager chat UI | Explicit repo/portfolio dossier with goals, observed work, freshness, approved decisions, pending proposals and QA placeholders. Fix missing-project-context behavior. |
| PM-402: Typed user decisions | `src/planning/decisions.ts`, revisioned policy/store, decision receipts UI | Authenticated priority/scope/pause/resume commands linked to conversation turns; distinguish queued action from observed effect. Depends on PM-401. |
| PM-403: Planning and dependencies | `src/planning/{planner,readiness,dependencies}.ts`, work/board UI | Bounded prioritized backlog, readiness rules, explicit blockers/cycles and merged/released/deployed dependency milestones. Depends on PM-402. |
| PM-404: GitHub ticket authoring | Issue adapter, outbox, `studio/app/manager/work/`, ticket editor | Adopt/refine/create scoped issues with criteria and QA recipe, stable operation key, source links and Copy ticket link. Depends on PM-403. |
| PM-405: Planning quality evaluation | Labeled sanitized task histories, evaluator and browser acceptance fixtures | Check relevant/nonduplicated tasks, unsupported status inference, blocker coverage and usable handoff. Independently label representative cases from both repo domains. |

## Planning contract

A Ready ticket names the problem/outcome, scope and exclusions, owned component, numbered observable criteria, dependencies, priority rationale, verification/evidence recipe and completion milestone. Goals/requirements are explicit; no invented deadlines or owners. New ideas stay proposed until selected, while tickets within agreed scope can be created automatically under recorded delegation.

The user can change relative repo priority and WIP from chat or settings. Preserve human edits and reject stale plans via expected revisions. Blocked work retains its status and offers an independent next action. An issue handoff records the accepted criteria revision and a stable GitHub URL; the manager does not start a coding agent or modify code itself.

Legacy note facts remain reviewed. Observed PR status is not hidden just because no note candidate has been approved. Source passages and issue/decision links are available from conversation messages. A model outage yields an actionable retry state and cached timestamped status; it must not repeat issue creation or a prior decision.

## Browser acceptance

Say “Prioritize chore-design; what should I do next?” See the decision recorded, rationale and a ready ticket link. Ask “what is blocked in agents?” See evidence, affected work and a concrete decision/action. Resolve that decision from the UI. Give Codex the chosen issue URL, then return to a persisted conversation. No terminal or copy/paste of repository Markdown is required to discover routine GitHub state.

## Verification and exit gate

- Chat questions cannot mutate state; explicit scoped decisions can. PR/README/log instructions cannot authorize actions.
- Ticket readiness, cycle detection, version conflicts, noisy duplicate ideas and unknown issue-write outcomes have contract/integration tests.
- Human evaluation covers procedural-instruction versus real-task errors exposed by the old demo. Agree measured quality/budget criteria before wider automatic ticket generation; fixture passes alone are insufficient.
- Staging browser workflow updates priorities, resolves a blocker and produces an actionable real issue without command-line work.

Exit: first useful hosted planning release for both repos. QA/merge remain visibly disabled. Rollback: pause planning writes, keep conversations/decisions/created issue receipts and let the user continue with existing tickets.
