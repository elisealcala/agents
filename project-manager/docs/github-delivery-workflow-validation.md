# GitHub delivery workflow validation

Date: 2026-10-30. Validation of proposed system design v1; not implemented capability.

The manager coordinates work for `elisealcala/chore-design` and `elisealcala/agents`. The user discusses priorities with it, gives Codex a ready GitHub issue, and delivers a PR. An independent QA capability evaluates that PR; the manager handles review publication, merge eligibility, progress updates and the next ready issue. It contacts the user when their attention can change an outcome.

This report accompanies [the canonical system design](github-delivery-system-design.md). The examples are fictional. The tabletop and executable model check proposed behavior, not live GitHub/LLM/runner operation.

## Requirement register

| ID | User requirement | Design acceptance condition |
|---|---|---|
| R01 | Manage both named repos | Every project, issue, PR, command, evidence item and notification has an explicit binding; names alone never select a repo. |
| R02 | Talk directly with the manager | A project-scoped conversation can answer fresh status and turn authenticated user decisions into durable versioned commands; portfolio questions explicitly select both repos. |
| R03 | Decide next steps and keep priorities | Persist ordered ready work, dependency edges, rationale and user priority changes. Recommend one next action per repo plus cross-repo tradeoffs. |
| R04 | Identify blockers | Distinguish product decisions, missing prerequisites, code findings, flaky checks, credentials and integration outage. Each blocker has evidence, owner, next action and resolution condition. |
| R05 | Proactively reach out | A persistent scheduler delivers one notification per meaningful blocker/decision/idea state change and retries delivery failures; unchanged scans remain silent. |
| R06 | Create GitHub Projects | Discover/reuse a bound existing Project or create one with a durable operation ID; bind repo, item IDs and required fields. Recover partial provisioning without duplicate boards. |
| R07 | Create useful tickets | A ready issue has problem, scoped outcome, acceptance criteria, dependencies, verification/evidence expectations and a clear done condition. Description changes are versioned. |
| R08 | User/Codex own coding | Issue handoff includes stable URL and revision; manager never silently starts a coding agent or fixes QA findings itself. |
| R09 | Receive PR with evidence | PR events or explicit PR submission resolve issue links and capture current head/base plus the author's claims/artifacts. Claims do not become trusted QA results. |
| R10 | QA independently tests | Isolated QA runs trusted plans against the candidate version; logs/artifacts and per-criterion coverage are retained. Missing or impossible verification is `inconclusive`, not pass. |
| R11 | Comment/request changes/approve | Publish findings tied to the assessed version with a permitted reviewer identity. Code changes trigger a new assessment. |
| R12 | Manager merges | Only current QA approval, passing required checks/rules and no blockers/pause permit merge; write is conditional on the approved head and reconciled to an observed merge result. |
| R13 | Update progress and continue | Actual merge evidence drives issue/project updates; incomplete criteria remain open; dependent work is unblocked and next tickets prepared without false completion. |
| R14 | Recover reliably | Duplicate/out-of-order/missed events, restarts, timeouts and ambiguous writes cannot duplicate tickets or use stale QA to merge. |
| R15 | Preserve independent agent banks | Runtime work uses explicit repo/component/task bindings. Manager does not merge or crawl other agents' development banks as shared project memory. |

All requirements have a proposed design contract below. This is design coverage only; runtime acceptance requires integration and real QA evaluation.

## Sources, decisions and authority

Keep three lanes in every status response and persistent record:

1. **Observed state:** typed GitHub snapshots/events and trusted runner receipts, retaining source identity, observed time, source version and last synchronization time. These can update operational status without asking the user to approve that a PR exists.
2. **Human intent:** authenticated conversation decisions and explicit GitHub owner edits, retaining actor, exact decision, scope, expected state revision and resulting commands. A scoped instruction such as “prioritize chore-design this week” updates a priority policy, rather than becoming an extracted candidate.
3. **Proposals:** extracted note facts, inferred blockers, suggested priorities and new ideas. The existing pending fact review remains intact. A model cannot promote a guessed status, PR prose, comment or README instruction into authoritative operational state.

The model proposes bounded plans with references to evidence IDs. A deterministic policy/reducer validates repository scope, versions, user authority, prerequisites and action eligibility. Arbitrary issue text, PR diffs and test logs are evidence, not tool-use instructions. Commands are typed and allowlisted; no arbitrary shell command comes from a model answer.

An answer says what is observed, what is proposed and what needs a decision. When synchronization is unavailable it gives last-known state and its timestamp, states the outage, and refuses a fresh merge decision. It does not answer only “no approved facts” when a typed PR snapshot exists.

## Workflow state model

Use separate dimensions so a blocked ticket is still distinguishable from a failing QA run.

| Aggregate | States | Important guards |
|---|---|---|
| Repository binding | `configuring`, `active`, `degraded`, `paused`, `retired` | Binding is active only after access, Project mapping, notification route and QA/review capabilities are verified. Degraded read access can still support timestamped answers; merge requires healthy authoritative access. |
| Issue work | `proposed`, `ready`, `in_progress`, `in_review`, `done`, `cancelled` | Ready requires actionable criteria and resolved dependencies. Done requires criterion coverage and confirmed integration; closed without completion is not done. |
| PR assessment | `discovered`, `waiting_for_evidence`, `queued`, `running`, `changes_requested`, `inconclusive`, `approved`, `merge_pending`, `merged`, `closed_unmerged`, `stale` | Approval is scoped to an assessment fingerprint, never to PR number alone. Draft or unlinked PRs wait rather than auto-merge. |
| Blocker | `open`, `waiting_on_user`, `waiting_on_external`, `resolved`, `superseded` | Holds affected object and owner; a check failure with a clear code finding can return to user/Codex without blocking unrelated work. |
| Command | `planned`, `eligible`, `dispatched`, `confirmed`, `rejected`, `outcome_unknown`, `superseded` | Unknown external outcome is reconciled before retry. No “successful” command until the observable effect is confirmed. |
| Notification | `queued`, `sending`, `delivered`, `retry_wait`, `failed`, `superseded` | Delivered requires channel acknowledgment; writing the outbox alone is not delivery. |

`paused` is also an orthogonal repository/issue control. A pause increments control revision, invalidates queued write eligibility and cancels/drains jobs where possible. It suppresses all new writes and merge requests, while allowing read-only reconciliation. If a merge request was already accepted externally, record what happened and notify once; never imply that a pause can undo an already completed merge.

## Events, commands and version guards

Inbound events include `user.decision`, `issue.changed`, `project.item.changed`, `pr.opened`, `pr.synchronized`, `pr.ready`, `review.changed`, `check.completed`, `qa.completed`, `dependency.changed`, `timer.due`, `integration.failed` and `reconciliation.observed`. Webhook payloads are hints; fetch current resources before consequential decisions. Use provider event IDs for inbox deduplication and update versions to reject older facts.

Outbound commands include `ensureProject`, `ensureIssue`, `updateManagedIssueFields`, `updateProjectItem`, `scheduleQA`, `publishReview`, `mergePR`, `resolveBlocker` and `deliverNotification`. An action carries `commandId`, `projectId`, `repoNodeId`, `aggregateId`, `expectedRevision`, `policyVersion`, idempotency/reconciliation identity, initiating evidence IDs and the desired effect. Command completion and local state transition commit together; remote calls run through the durable outbox.

The QA assessment fingerprint contains:

```text
repo ID + PR ID + head SHA + base SHA
+ linked issue IDs and acceptance-criteria revisions
+ QA plan revision + runtime/toolchain image digest + policy revision
```

Bind technical checks to head and, where integration matters, to the tested merge candidate/base. A changed head, base, criteria, linked issue set or QA/policy revision makes the prior assessment stale. A purely editorial title change need not invalidate QA; the comparison must recognize semantic criteria changes conservatively. A deterministic implementation can initially invalidate on any managed criteria-section edit.

## Normal orchestration

1. **Onboard:** bind explicit repo IDs; inventory existing issues/Projects before creating anything. Reuse the existing board if appropriate; set managed-field ownership and board mapping. Establish trust policy, reviewer identity, runner profile, notification route and merge method. Capability checks reveal unsupported Projects or review operations before autonomous mode is advertised.
2. **Plan:** reconcile current GitHub state, retrieve approved product decisions, select a bounded actionable backlog, and save rationale/dependency graph. Within agreed project scope, author/refine tickets without another confirmation on every routine write. Ask only for a real product ambiguity or conflicting priority. New ideas remain proposals until selected.
3. **Handoff:** user asks “what should I do next?” Manager returns the top ready ticket URL, outcome, scope, dependencies and verification expectations. User tells Codex to implement that ticket. Opening a branch is optional evidence of progress; explicit assignment/start or linked PR advances the work.
4. **Receive PR:** resolve linked issues from explicit references, snapshot the current PR and issue criteria, capture author evidence, and queue QA. A PR cannot silently claim an unrelated/cross-repo issue or satisfy multiple tickets solely through a closing keyword.
5. **Run QA:** runner checks the candidate in isolation. It combines automated results with per-criterion review, returns findings with file/line or reproducible behavior references, and indicates `pass`, `fail`, `inconclusive` or `cancelled`. The independent QA assessor may inspect author evidence but must reproduce material checks or explicitly mark them unverified.
6. **Publish outcome:** fail produces one coherent request-changes review for that fingerprint; inconclusive produces a comment/blocker with the missing capability/evidence; pass produces a review only if identity and repository rules permit it. Every update is idempotent. User/Codex change code; `pr.synchronized` supersedes the old QA job and starts a new one.
7. **Merge:** deterministic merge eligibility re-fetches current head/base, criteria, checks, review state, branch rules, pause and policy revision. It requires no unresolved blocking findings and approved criterion coverage for every issue claimed complete. Use the expected approved head in the merge request; that head guard does not atomically bind the base. Require server-enforced strict up-to-date required checks and no bypass, and invalidate/rerun integration QA on base movement. The first slice rejects merge-queue branches until QA on `merge_group` candidates has a separate verified contract. A merge conflict returns the work to user/Codex.
8. **Close loop:** observe merge SHA and issue states; reconcile each issue's completion independently, update Project fields, release dependencies, retain the QA artifact and prepare the next ready ticket. A failed Project update leaves `progress_sync_pending` and retries without attempting another merge. Say “merged; board update pending” rather than “everything completed.”

## Multi-issue and cross-repository work

Use a coverage matrix `issue → criterion revision → QA evidence → satisfied/not_satisfied/unknown`. One PR may satisfy several issues, or several PRs may satisfy one issue. Merging one PR never automatically completes every linked ticket. Treat GitHub automatic issue closure as an observed external effect: if a closing keyword prematurely closed an incomplete issue, reopen/annotate it through a reconciled managed action and leave its Project item in progress.

Dependencies are explicit edges across repo-bound issue IDs. A dependency can require `merged`, `released`, `deployed` or an explicit human decision. A merge in agents is not proof a deployed manager feature is available to chore-design. Each edge declares its satisfaction evidence. The user may prioritize independent work while a dependency waits; a dependency cycle is a planning blocker, not a reason to keep proposing the same ticket.

For the agents collection, a ticket names the owned component and its development-memory boundary. The project manager does not read every agent bank to answer portfolio status. PR evidence and GitHub issue state are runtime project evidence; component agents continue their own bank protocol during implementation.

## Failure, concurrency and human control

| Event | Required response |
|---|---|
| API timeout after creating a ticket | Mark command outcome unknown; query for the durable operation marker/known target before retry. If outcome cannot be disambiguated, surface one blocker rather than duplicate the issue. |
| Duplicate webhook or repeated PR submission | Inbox/job identity deduplicates; one assessment per fingerprint and one review/notification per outcome transition. |
| Out-of-order event | Fetch current resource; an old approval/check completion cannot overwrite a newer head or closed state. |
| Missed webhook/service down | Scheduled incremental reconciliation plus periodic full inventory recover state, with cursor overlap and deduplication. Mark status freshness; no missed-event assumption of success. |
| Manager restart during QA/merge | Durable job lease expires; inspect runner or GitHub effect and requeue/resume only the unresolved step. Existing Store startup behavior is insufficient for these workflows. |
| User edits priority or ticket criteria while model plans | Expected revision rejects the stale plan. Human-owned fields are preserved. Criteria edit invalidates QA and queued merge eligibility. |
| Manual merge/close by user | Record external action, update progress, flag missing QA as an exception. Do not rewrite history to claim the agent approved it. |
| Same identity as PR author | Keep tests/results, but do not claim an eligible independent approval. Require configured independent reviewer identity or classify formal approval as blocked. |
| Required review/check cannot be obtained | Await it and identify owner/next action; no rules bypass. |
| Model, runner or API unavailable | Apply bounded retry/backoff and circuit breaker; technical failure is inconclusive. Route one meaningful blocker and continue independent planning/read work. |
| Manager self-update PR changes QA policy/workflow | Running trusted release pins policy/runner configuration. Candidate code cannot redefine its own merge gate. Merge creates a deployment task; activate new policy only through separately verified deployment and health check. |
| Reviewer requests changes after QA pass | Re-fetch reviews at merge eligibility; hold until resolved under policy. |
| PR check concludes after new head pushed | Store as historical result only; it cannot satisfy the new fingerprint. |

The manager is a persistent service independent of this chat. Deploy service/database/queue plus scheduled reconciler and isolated runner on an always-on host. A sleeping local machine has no proactive availability guarantee. The concrete initial attention route is a durable Studio inbox plus bot comments that @mention the owner in a dedicated coordination issue per repo. Preflight the owner's GitHub notification settings with a test attention event. Publishing the comment is confirmed API delivery, not proof the user read a push/email; status distinguishes those facts. A later configured push route can improve delivery independently. An inactive browser page alone does not meet “reach out.”

## Attention policy

Notification key: `(recipient, repo, object, reason, material_state_version)`. Send when a decision is required, a meaningful blocker appears/changes, an actionable idea is ready for consideration, or a delivery milestone completes. Include evidence links, effect on work, recommended action and choices. A technical retry or unchanged pending check is not a new notification.

Group related findings into one message; honor snooze/pause and reminder policy. If a useful idea is deferred, do not resurface it until its premise or the agreed review time changes. Delivery failures are retried; permanent failure is visible in the manager's own health/inbox and alternate configured route. Before retrying an ambiguous comment write, reconcile its durable notification marker to avoid duplicate @mentions. Status messages show the latest synchronization and delivery health rather than falsely promising contact.

## Tabletop simulation, round 1: deliberately incomplete design

Initial candidate: “listen to PR events → QA passes → approve → merge → mark linked issues done; a timer emails blockers.” Apply the user's workflow and adverse events:

| Step/case | Round-1 result | Gap found | Required revision |
|---|---|---|---|
| User asks which repo to work on | No shared ordered priorities/rationale | R02/R03 not met | Add portfolio query and versioned user decisions. |
| Manager creates a Project, request times out | Blind retry creates duplicate board | R06/R14 not met | Durable operation identity and effect reconciliation. |
| User opens PR for two tickets; one criterion is missing | Both tickets marked done | R07/R10/R13 not met | Per-issue criterion coverage and observed closure repair. |
| QA approves head A; user pushes B before merge | Old approval merges B | R11/R12 not met | Fingerprint and expected-head merge guard. |
| Base or ticket criteria change while QA runs | Passing result from old context reused | R10/R12 not met | Bind base, criteria, plan and policy; stale/cancel/requeue. |
| Manager restarts after successful remote merge | Retried merge/finalization produces confused state | R13/R14 not met | Job leases and unknown-outcome reconciliation. |
| PR author and review token are the same user | Approval assumed valid | R11 not met | Capability/identity check before autonomous-mode activation. |
| Timer finds the same blocker every interval | Repeated notifications | R05 not met | Material-transition deduplication and delivery state. |
| PR changes the manager's merge policy | Candidate relaxes its own gate | R10/R12 not met | Trusted control plane and separate deployment activation. |
| Local machine sleeps | Nothing reaches the user | R05/R14 not met | Always-on worker plus verified outbound delivery. |

Round 1 fails. The revisions above are incorporated into the state and command contracts in this draft.

## Tabletop simulation, round 2: revised end-to-end story

All IDs below are fictional; no existing ticket or capability is claimed.

| # | Input | Expected transition and observable output | Requirements |
|---|---|---|---|
| 1 | Bind both repos; Projects capability and QA identity checks succeed | Reuse/discover Projects, persist bindings and verify notification delivery; manager reports each setup capability. If any fails, onboarding remains degraded and names the missing piece. | R01/R06/R14 |
| 2 | User: “Prioritize chore-design's token export; keep agents QA work second.” | Persist human decision D1 and ordered backlog. Propose chore-design C1 with criteria and dependency-free status; prepare agents A1 separately. | R02/R03/R07 |
| 3 | User asks “what next?” and sends C1 to Codex | Return C1 URL and handoff revision; C1 becomes in progress from explicit start/linked PR. No coding agent is silently launched. | R02/R08 |
| 4 | User submits chore-design PR C-PR1 with evidence for C1 plus C2 | Snapshot head H1/base B1 and criteria revisions. Criterion matrix identifies C2's required browser test is absent. | R09/R10 |
| 5 | QA reproduces a token collision and missing browser behavior | Publish request-changes for H1, attach evidence; PR is changes requested. Notify once with findings and next action to user/Codex. | R04/R05/R11 |
| 6 | User/Codex push H2; old H1 test success arrives late | H1 result is historical. Queue H2 assessment; do not publish stale approval. | R10/R11/R14 |
| 7 | User edits C2 criteria during H2 QA | Supersede fingerprint; notify QA context change without treating it as a code defect. Queue H2 against updated criteria. | R07/R10/R12 |
| 8 | QA passes all criteria; base moves B1→B2 | Mark assessment stale, rerun required integration checks on B2. Later pass produces current independent review. | R10/R11/R12 |
| 9 | User pauses the repo before merge dispatch | Pause revision rejects queued merge. Read-only status says approved, paused, awaiting resume. | R02/R12/R14 |
| 10 | User resumes; revalidation passes; merge request times out | Persist outcome unknown. Reconciliation observes confirmed merge M1 and finalizes exactly once. | R12/R14 |
| 11 | GitHub board update fails after merge | Say merged, progress sync pending; retry board action only. Once confirmed, C1/C2 become done and next ready ticket is selected. | R03/R13/R14 |
| 12 | Agents A1 depends on deployed manager QA feature, not just merged code | A1 remains blocked until verified deployment evidence arrives; manager identifies the dependency and lets user choose other ready work. | R03/R04/R13 |
| 13 | User/Codex deliver A1 PR changing manager QA policy | Trusted running policy and runner assess candidate; successful merge produces a separate deployment follow-up. Candidate policy does not gate itself. | R09/R10/R12/R15 |
| 14 | Reconciler sees no changes in either repo for several intervals | No repeated notification. An actionable test-reuse idea is stored once as proposed and delivered with rationale; no ticket is silently declared committed scope. | R05/R07 |
| 15 | Webhook was missed during service restart; explicit status question follows | Reconcile latest PR/check/issue state from GitHub, state freshness and any outage; resume durable jobs without duplicate issues/reviews/merges. | R02/R14 |
| 16 | User asks “what shipped, what's blocked, and what should I do next?” | Return merged evidence and criterion coverage, open blockers with owners/choices, and ordered ready ticket links for both repos; distinguish pending ideas. | R01–R05/R13 |

Round 2 has a specified expected outcome for every user requirement. It remains a tabletop and does not establish real integration correctness, planning quality, QA defect detection, notification delivery or merge safety.

## Suggested bounded executable design model

Build a separate pure simulation that consumes events, uses in-memory GitHub/runner/delivery doubles and emits commands. Do not start services or operate real repos. A trace entry records `event`, `before`, `guard_decision`, `commands`, `after` and invariant results. Freeze the initial incomplete policy and revised policy to demonstrate the found gaps rather than tuning only the final examples.

Minimum cases: complete happy path for each repo; changes-requested correction; multi-issue incomplete coverage; duplicate event; missed event reconciliation; stale head; stale base; changed criteria; unknown create outcome; unknown merge outcome; post-merge Project failure; restart job lease; pause before dispatch; pause after remote acceptance; ineligible reviewer identity; outdated late check; required review failure; dependency cycle; merge-versus-deployment dependency; self-policy modification; quiet unchanged monitoring; failed notification delivery/retry; manual merge without QA; closed PR without merge.

Core invariants:

1. Every command's repo matches its aggregate binding.
2. No merge command without a current complete approval fingerprint and all deterministic gates.
3. No stale or late QA result can approve the current candidate.
4. A ticket is done only when every completion criterion has accepted integration evidence.
5. No duplicate external action for one durable operation identity.
6. No completed external action is inferred solely from a timeout or local intent.
7. Pause prevents new eligible mutations; already accepted remote effects are reconciled honestly.
8. New ideas remain proposals until selected within the user's product direction.
9. Unchanged state produces no new attention message.
10. Delivery acknowledgment is necessary for `delivered`; outbox entry alone is insufficient.
11. Candidate code/configuration cannot modify the trusted policy used to assess itself.
12. Note extraction never auto-approves pending candidate facts.

A passing model is evidence that the modeled transitions satisfy these invariants on the simulated traces. Before deployment, independently test actual GitHub capabilities, concurrency/conditional writes, runner isolation, notification delivery and representative planning/QA scenarios, including failures not encoded in the model.


## Executed model and final revisions

The executable offline [model](simulations/delivery_workflow.py) and [JSON trace report](simulations/delivery-workflow-report.json) were run after the tabletop. Final result: incomplete strawman **9/41**; revised model **41/41**. Both repository PRs now traverse QA and merge in the positive scenario. The strawman is an intentionally incomplete design, not the existing manager runtime.

Independent orchestration review caught a false-positive notification test: unique stored records hid repeated actual sends. The revision counts delivery attempts, skips delivered/acknowledged messages, and exercises a failed send followed by retry, acknowledgement and repeated observation. A subsequent review found partial PR completion was conflated with whole-ticket completion; the revised model allows verified partial contributions to merge and keeps the ticket open until a final contribution is observed. QA fingerprints now include repo, PR, head, base, criteria, linked issues, plan, policy and environment.

System-design review additionally required a concrete VM/microVM boundary with writable disposable builds and an outage observer outside the manager host. Both were incorporated. Final merge policy explicitly discloses non-atomic external edits, supports pause before dispatch, and reconciles already accepted effects.

Artifact verification then found a further counterexample: an external delivery retry could still send after the user had acknowledged the durable inbox item. The model now treats acknowledgement as a terminal suppression condition for that material notification state and checks failed-send → inbox acknowledgement → retry suppressed. This raises the final replay to 41 cases.

The model is deliberately bounded. It does not implement real API operations, durable disk/lease recovery, rich multi-issue criterion graphs, status conversation generation, realistic model QA, external delivery or bank access. R15 is design/tabletop-only. The broad model requirement tags describe affected design areas and must not be read as exhaustive runtime acceptance. A passing fixture report cannot establish end-to-end readiness.

## Remaining verification before operation

- Configure and test real owner Projects access, bot review eligibility and branch rules in both repos.
- Verify hosted authenticated chat/MCP, backups/restore, durable job recovery and unknown API outcomes.
- Run real seeded-defect and corrected PRs with independent QA and observable test artifacts.
- Validate partial/multi-PR issue completion, cross-repo merged-versus-deployed dependencies and human edits/pause races.
- Acknowledge an actual outbound test alert with chat closed, and prove external host-outage detection.
- Measure representative planning, blocker detection, ticket usability and QA defect detection against human labels.

No real GitHub writes, QA tests of candidate code, merges, background services or notifications were performed in this design session.

## Final artifact verification

An independent verifier reran the final model: **41/41** revised cases pass and the saved JSON matches the fresh replay exactly. Python syntax, whitespace, local Markdown links, R01–R15 register and final scenario counts pass. The additional acknowledgement-before-delivery counterexample is fixed; verified partial contributions merge without marking an incomplete ticket Done. No material contradictions were found in the final design. Production build/tests were outside this documentation/model-only check.
