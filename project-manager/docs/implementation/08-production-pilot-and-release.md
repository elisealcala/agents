# Stage 8 — Production pilot and complete workflow acceptance

Status: Planned. Depends on all prior stage gates. This is the release gate for the full requested workflow.

## Outcome

The deployed manager completes the user's actual planning→ticket→PR→QA→correction→merge→progress loop across both repos, and proactively contacts the user without terminal interaction. Readiness is based on implementation evidence, not the design simulator.

## Implementation slices

| Ticket | Owned paths, proposed unless existing | Deliverable and dependency |
| --- | --- | --- |
| PM-801: Full browser acceptance suite | `studio/tests/manager/`, isolated integration fixtures | Run the complete user journeys, session/permissions/accessibility, stale/offline/error states and current-version evidence navigation. |
| PM-802: Real two-repo controlled pilot | Release evidence under manager docs/reports, labeled GitHub test objects | One deliberately defective PR and correction per relevant repo profile, real Project/ticket/review/merge/progress evidence, meaningful notification and acknowledgement. |
| PM-803: Planning/QA quality gates | Human-labelled representative tasks/PRs and evaluation reports | Score ticket relevance/usability, unsupported claims, blocker/defect misses, correct abstention and resource cost. Agree thresholds before autonomous production capability is enabled. |
| PM-804: Failure/restore/release drill | CI/deploy configuration, migration and restore runbook | Restart during QA/unknown merge, restore isolated backup, revoke tokens, exercise host outage, roll back compatible image and retain action receipts. |
| PM-805: Production promotion and user walkthrough | Protected release environment and browser operations guide | Publish the verified image/config version, enable capabilities per repo, confirm owner sign-in and no-terminal daily workflow. |

## Required acceptance story

1. Sign into the deployed manager from a browser with no local services.
2. Ask status across both repos, set a relative priority and inspect the recorded decision.
3. Resolve a real planning ambiguity/blocker; receive a useful issue with criteria, dependencies and QA recipe.
4. Give that ticket to Codex, implement and submit a linked PR with evidence.
5. Have QA independently reproduce a seeded defect; inspect its report and GitHub change request.
6. Correct the PR through Codex; see old QA superseded and the current candidate verified.
7. Exercise a stale head/base or pause conflict and verify the merge is withheld/revalidated.
8. Permit the delegated manager to merge after real required checks and eligible review; inspect merge SHA and complete/partial ticket progress.
9. Observe a board-update failure recover without duplicate merge, and a dependency remain blocked until its declared deployed/released milestone.
10. Repeat the delivery path for the other repo profile and inspect a meaningful portfolio next-action answer.
11. Close the browser/laptop, receive a useful blocker or idea, reopen the hosted inbox and acknowledge/decide without a terminal.
12. Demonstrate quiet unchanged monitoring, revoked-connection recovery, service/host outage and backup restoration with honest freshness/effect reporting.

## Evidence and acceptance

Trace R01–R15 from the [validation register](../github-delivery-workflow-validation.md) to actual browser/integration artifacts, release SHA, GitHub URLs and unresolved limitations. Include separate semantic-quality results; counts from the 41-case design model do not transfer into runtime pass claims. A user can navigate evidence from the app rather than searching a terminal log.

Document known unsupported repo modes and capability-level gates. Do not enable a repo's auto-merge because another repo passed its setup. Test manager self-update under the trusted deployed controller; merge creates a separately verified deployment release, not automatic execution of candidate controller code.

Exit: the complete release story passes with agreed planning/QA quality and real notification/restore evidence, the owner completes the browser walkthrough, and protected production promotion records the deployed version. If any gate fails, keep the affected capability disabled, create a specific follow-up ticket and repeat that stage's acceptance; preserve useful already-deployed planning features.

Rollback: pause new external mutations, drain/reconcile accepted work, promote a compatible prior image or restore through the migration runbook, and expose actual integration/progress state. Never delete GitHub history or label externally merged work as unmerged to simplify local rollback.
