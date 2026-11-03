# Project Manager: small-session GitHub backlog

Created 2026-11-02 at the user's request to fit one Codex session per ticket. Initially split Stages 3–8; the user then requested publishing the existing Stage 2 foundation and splitting its remaining work. There are now 86 child issues across Stages 2–8. Stage 1 is complete and unchanged. GitHub is the work tracker; ticket creation is not evidence of stage completion.

Project: [Project Manager — Implementation](https://github.com/users/elisealcala/projects/3).

## How to use

1. Continue Stage 2 with [#103 — reproducible Cloudflare validation in CI](https://github.com/elisealcala/agents/issues/103). Start Stage 3 with [#29 — GitHub App client and repository identity checks](https://github.com/elisealcala/agents/issues/29) only after Stage 2 (#22) meets its exit gate.
2. Give a fresh Codex session one child issue URL. Read the owning component's required bank files, the ticket, and only its relevant stage/design/source sections.
3. Target the ticket's 3–4 implementation/test files. Required progress/active-context notes are additional. Proposed paths may adapt to the implemented boundary; split a follow-up if additional behavior would exceed a session.
4. Run the ticket's focused checks; record the exact result, remaining limitation and next prerequisite. Do not ask a session to implement the parent stage.
5. Acceptance/drill tickets collect evidence. Open small defect follow-ups rather than absorbing feature repairs into acceptance work.

Native GitHub parent/sub-issue relationships link all 86 children to their seven stages. The subtasks were also added to the existing Project. Prerequisites are linked in issue bodies, not configured as native blocked-by fields. Ordered session guides are comments on each parent. Stage gates and capability restrictions remain unchanged; future work is not Ready merely because it appears on the board.

| Stage | Parent | Child count | Range |
| --- | --- | --- | --- |
| 2: Private hosted application — remaining work | [#22](https://github.com/elisealcala/agents/issues/22) | 12 | #103–#114 |
| 3: GitHub connections, inventory and Projects | [#23](https://github.com/elisealcala/agents/issues/23) | 14 | #29–#42 |
| 4: Conversations, priorities and ready tickets | [#24](https://github.com/elisealcala/agents/issues/24) | 13 | #43–#55 |
| 5: PR intake and independent QA | [#25](https://github.com/elisealcala/agents/issues/25) | 13 | #56–#68 |
| 6: Reviews, protected merging and progress | [#26](https://github.com/elisealcala/agents/issues/26) | 12 | #69–#80 |
| 7: Proactive attention and browser operations | [#27](https://github.com/elisealcala/agents/issues/27) | 11 | #81–#91 |
| 8: Production pilot and complete workflow acceptance | [#28](https://github.com/elisealcala/agents/issues/28) | 11 | #92–#102 |

## Stage 2: private hosted application — remaining work

The existing local foundation is being published separately from hosted completion. Reuse its auth/private boundary, durable storage, paired import and backup primitives. Start with #103; keep #22 open until the final hosted acceptance passes. Code/configuration tickets target 3–4 files; account/deployment/drill sessions may change only 3–4 evidence/configuration files. Required component-bank notes are additional.

- [#103 — [PM-204a] Add reproducible Stage 2 Cloudflare validation in CI](https://github.com/elisealcala/agents/issues/103)
- [#104 — [PM-204b] Drive delivery jobs with durable Cloudflare wakeups](https://github.com/elisealcala/agents/issues/104)
- [#105 — [PM-204c] Configure private R2 backups with the approved retention rule](https://github.com/elisealcala/agents/issues/105)
- [#106 — [PM-201a] Finish staging OAuth registration and server secret setup](https://github.com/elisealcala/agents/issues/106)
- [#107 — [PM-205a] Deploy the private storage and web staging Workers](https://github.com/elisealcala/agents/issues/107)
- [#108 — [PM-202a] Verify the deployed same-origin private service boundary](https://github.com/elisealcala/agents/issues/108)
- [#109 — [PM-201b] Verify real owner-only GitHub sign-in and session expiry](https://github.com/elisealcala/agents/issues/109)
- [#110 — [PM-205b] Cut over the verified manager and evidence snapshot pair](https://github.com/elisealcala/agents/issues/110)
- [#111 — [PM-204d] Verify hosted automatic backups and owner download](https://github.com/elisealcala/agents/issues/111)
- [#112 — [PM-204e] Rehearse isolated hosted restore and compatible rollback](https://github.com/elisealcala/agents/issues/112)
- [#113 — [PM-203a] Verify degraded setup, service health and browser-only operation](https://github.com/elisealcala/agents/issues/113)
- [#114 — [PM-205c] Record Stage 2 hosted acceptance and unlock Stage 3](https://github.com/elisealcala/agents/issues/114)

## Stage 3: GitHub connections, inventory and Projects

- [#29 — [PM-301a] Add GitHub App client and repository identity checks](https://github.com/elisealcala/agents/issues/29)
- [#30 — [PM-301b] Persist encrypted connection credentials and capability state](https://github.com/elisealcala/agents/issues/30)
- [#31 — [PM-301c] Wire the owner-only GitHub App installation callback](https://github.com/elisealcala/agents/issues/31)
- [#32 — [PM-301d] Add separate personal Projects authorization and rotation](https://github.com/elisealcala/agents/issues/32)
- [#33 — [PM-302a] Fetch paginated repository issue and PR inventory](https://github.com/elisealcala/agents/issues/33)
- [#34 — [PM-302b] Map PR checks and reviews into source-linked observations](https://github.com/elisealcala/agents/issues/34)
- [#35 — [PM-302c] Persist restart-safe sync checkpoints and reconciliation](https://github.com/elisealcala/agents/issues/35)
- [#36 — [PM-303a] Discover and adopt existing personal Project mappings](https://github.com/elisealcala/agents/issues/36)
- [#37 — [PM-303b] Create a missing Project with recoverable operation receipts](https://github.com/elisealcala/agents/issues/37)
- [#38 — [PM-303c] Project issue items and fields through independent operations](https://github.com/elisealcala/agents/issues/38)
- [#39 — [PM-304a] Build browser connection and Project selection settings](https://github.com/elisealcala/agents/issues/39)
- [#40 — [PM-304b] Show repository inventory and sync freshness in the UI](https://github.com/elisealcala/agents/issues/40)
- [#41 — [PM-305a] Exercise sync and Project recovery through real components](https://github.com/elisealcala/agents/issues/41)
- [#42 — [PM-305b] Verify Stage 3 on hosted GitHub connections and boards](https://github.com/elisealcala/agents/issues/42)

## Stage 4: Conversations, priorities and ready tickets

- [#43 — [PM-401a] Assemble scoped planning context with sources and freshness](https://github.com/elisealcala/agents/issues/43)
- [#44 — [PM-401b] Serve grounded status conversations with honest model outages](https://github.com/elisealcala/agents/issues/44)
- [#45 — [PM-401c] Build scoped conversation UI with navigable citations](https://github.com/elisealcala/agents/issues/45)
- [#46 — [PM-402a] Apply authenticated revision-checked priority and pause decisions](https://github.com/elisealcala/agents/issues/46)
- [#47 — [PM-402b] Show decision receipts and priority controls in the browser](https://github.com/elisealcala/agents/issues/47)
- [#48 — [PM-403a] Resolve cross-repository dependency milestones and cycles](https://github.com/elisealcala/agents/issues/48)
- [#49 — [PM-403b] Validate ticket readiness and bounded work in progress](https://github.com/elisealcala/agents/issues/49)
- [#50 — [PM-403c] Generate bounded prioritized backlog proposals](https://github.com/elisealcala/agents/issues/50)
- [#51 — [PM-404a] Author scoped GitHub issue drafts and preserve human edits](https://github.com/elisealcala/agents/issues/51)
- [#52 — [PM-404b] Dispatch ticket writes with idempotent unknown-outcome recovery](https://github.com/elisealcala/agents/issues/52)
- [#53 — [PM-404c] Build the ready-work editor and Copy ticket link handoff](https://github.com/elisealcala/agents/issues/53)
- [#54 — [PM-405a] Evaluate planning quality on labelled examples from both repos](https://github.com/elisealcala/agents/issues/54)
- [#55 — [PM-405b] Verify the hosted priority-to-ready-ticket planning journey](https://github.com/elisealcala/agents/issues/55)

## Stage 5: PR intake and independent QA

- [#56 — [PM-501a] Bind PR contributions and evidence to exact revisions](https://github.com/elisealcala/agents/issues/56)
- [#57 — [PM-501b] Ingest linked PRs and invalidate stale QA bindings](https://github.com/elisealcala/agents/issues/57)
- [#58 — [PM-502a] Define trusted execution profiles for the two repository domains](https://github.com/elisealcala/agents/issues/58)
- [#59 — [PM-502b] Provision and dispose of one isolated QA execution machine](https://github.com/elisealcala/agents/issues/59)
- [#60 — [PM-502c] Execute trusted probes and attest results outside candidate control](https://github.com/elisealcala/agents/issues/60)
- [#61 — [PM-502d] Fence runner callbacks, cancellation and restart recovery](https://github.com/elisealcala/agents/issues/61)
- [#62 — [PM-503a] Build independent criterion-level QA plans](https://github.com/elisealcala/agents/issues/62)
- [#63 — [PM-503b] Assemble immutable QA reports and honest coverage verdicts](https://github.com/elisealcala/agents/issues/63)
- [#64 — [PM-503c] Coordinate independent QA attempts through durable jobs](https://github.com/elisealcala/agents/issues/64)
- [#65 — [PM-504a] Show current and historical QA with criterion coverage](https://github.com/elisealcala/agents/issues/65)
- [#66 — [PM-504b] Display actionable findings and protected QA artifacts](https://github.com/elisealcala/agents/issues/66)
- [#67 — [PM-505a] Measure seeded-defect detection and correction for both profiles](https://github.com/elisealcala/agents/issues/67)
- [#68 — [PM-505b] Verify hosted PR-to-QA correction and evidence navigation](https://github.com/elisealcala/agents/issues/68)

## Stage 6: Reviews, protected merging and progress

- [#69 — [PM-601a] Map QA findings to version-bound GitHub review drafts](https://github.com/elisealcala/agents/issues/69)
- [#70 — [PM-601b] Publish reviews with durable receipts and timeout reconciliation](https://github.com/elisealcala/agents/issues/70)
- [#71 — [PM-602a] Read branch rules, trusted check sources and review capability](https://github.com/elisealcala/agents/issues/71)
- [#72 — [PM-602b] Evaluate current-version merge eligibility deterministically](https://github.com/elisealcala/agents/issues/72)
- [#73 — [PM-602c] Show per-repository merge capability and blocked reasons](https://github.com/elisealcala/agents/issues/73)
- [#74 — [PM-603a] Dispatch expected-head protected merges with control revisions](https://github.com/elisealcala/agents/issues/74)
- [#75 — [PM-603b] Reconcile lost merge responses and restart without re-merging](https://github.com/elisealcala/agents/issues/75)
- [#76 — [PM-604a] Compute many-to-many contribution and ticket completion coverage](https://github.com/elisealcala/agents/issues/76)
- [#77 — [PM-604b] Project confirmed progress and repair premature issue closure](https://github.com/elisealcala/agents/issues/77)
- [#78 — [PM-605a] Show review, merge, pause and progress outcomes in the browser](https://github.com/elisealcala/agents/issues/78)
- [#79 — [PM-605b] Verify protected delivery races and partial-progress recovery](https://github.com/elisealcala/agents/issues/79)
- [#80 — [PM-605c] Run the controlled protected-merge pilot for both repositories](https://github.com/elisealcala/agents/issues/80)

## Stage 7: Proactive attention and browser operations

- [#81 — [PM-701a] Persist inbox acknowledgement, snooze and resolution state](https://github.com/elisealcala/agents/issues/81)
- [#82 — [PM-701b] Select meaningful attention and suppress unchanged scans](https://github.com/elisealcala/agents/issues/82)
- [#83 — [PM-701c] Build the private browser inbox with decisions and acknowledgement](https://github.com/elisealcala/agents/issues/83)
- [#84 — [PM-702a] Build public-safe bot attention payloads](https://github.com/elisealcala/agents/issues/84)
- [#85 — [PM-702b] Send bot mentions with durable receipts and ACK-aware recovery](https://github.com/elisealcala/agents/issues/85)
- [#86 — [PM-703a] Enforce durable budgets and dispatch timeouts](https://github.com/elisealcala/agents/issues/86)
- [#87 — [PM-703b] Expose health, safe retry and connection recheck operations](https://github.com/elisealcala/agents/issues/87)
- [#88 — [PM-703c] Build browser operations, budgets and test-alert controls](https://github.com/elisealcala/agents/issues/88)
- [#89 — [PM-704a] Run health monitoring independently of the manager host](https://github.com/elisealcala/agents/issues/89)
- [#90 — [PM-705a] Verify quietness, acknowledgement races and delivery recovery](https://github.com/elisealcala/agents/issues/90)
- [#91 — [PM-705b] Verify real attention delivery with the browser and laptop closed](https://github.com/elisealcala/agents/issues/91)

## Stage 8: Production pilot and complete workflow acceptance

- [#92 — [PM-801a] Complete browser regression for access, scope and sourced status](https://github.com/elisealcala/agents/issues/92)
- [#93 — [PM-801b] Complete browser regression for planning, handoff and QA evidence](https://github.com/elisealcala/agents/issues/93)
- [#94 — [PM-801c] Complete browser regression for merge progress and operations](https://github.com/elisealcala/agents/issues/94)
- [#95 — [PM-802a] Run the real chore-design planning-to-merge pilot](https://github.com/elisealcala/agents/issues/95)
- [#96 — [PM-802b] Run the real agents pilot and portfolio next-action journey](https://github.com/elisealcala/agents/issues/96)
- [#97 — [PM-803a] Freeze human-labelled planning and QA release cases](https://github.com/elisealcala/agents/issues/97)
- [#98 — [PM-803b] Score release quality and cost against frozen gates](https://github.com/elisealcala/agents/issues/98)
- [#99 — [PM-804a] Drill restart, revoked access and unknown remote outcomes](https://github.com/elisealcala/agents/issues/99)
- [#100 — [PM-804b] Drill isolated backup restore and compatible release rollback](https://github.com/elisealcala/agents/issues/100)
- [#101 — [PM-805a] Prepare protected production promotion and per-repo activation gates](https://github.com/elisealcala/agents/issues/101)
- [#102 — [PM-805b] Complete owner browser walkthrough and final requirement sign-off](https://github.com/elisealcala/agents/issues/102)

## Publication and validation

The GitHub connector permitted reads but returned 403 for issue creation; local CLI authentication was invalid. Creation and linking used the signed-in browser, without changing credential permissions. The initial Stage 3–8 read-back confirmed 74 unique issues (#29–#102), correct parent references, 3–4 expected implementation/test paths apiece, all required sections and resolved intra-stage issue references. Each parent's native sub-issue list was checked at creation. That initial task changed planning only.

The Stage 2 extension added 12 unique issues (#103–#114) with the correct #22 parent and resolved prerequisite links, and the native list confirms all 12. It accompanies authorized publication of the verified local foundation; hosted completion is still gated. See [foundation verification](stage-2-foundation-verification.md). No cloud resources or actual-data cutover were changed by this publication task.
