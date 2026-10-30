# GitHub project delivery loop

Date: 2026-10-30
Status: User requirements captured; expanded runtime not implemented.
Decision: DEC-007.

## Repositories

- https://github.com/elisealcala/chore-design
- https://github.com/elisealcala/agents

Both repositories were accessible through the GitHub connector during the requirements session. Connector access does not configure credentials or permissions for the independent manager runtime. No GitHub Projects, issues, PRs or settings were changed.

## User's intended workflow

1. The user talks directly with the project manager to check status, decide next steps and set priorities across both repositories.
2. The manager creates and maintains GitHub Projects and actionable issue descriptions. Tickets give the user enough context to point Codex at the work, with acceptance criteria and expected verification evidence.
3. The user and Codex own implementation from ticket through PR. The manager's role is delivery coordination, rather than acting as the coding agent.
4. The manager receives the PR and evidence. A QA capability checks the implementation against the ticket, runs appropriate verification, and records findings. The user suggested a QA agent inside the workflow; its exact runtime/process arrangement is undecided.
5. QA comments, requests changes or approves based on results. The user/Codex handle requested code changes and QA rechecks them.
6. The manager merges after QA and required checks permit it, updates issue/project progress, and continues preparing and prioritizing work.
7. The manager proactively reaches out about blockers, decisions requiring the user and useful new ideas. Routine unchanged monitoring should stay quiet. New ideas are proposals for discussion, not evidence of agreed scope or completed work.

## Existing foundation and missing capabilities

Existing: project records, immutable submitted Markdown, pending fact review, versioned approved state, grounded questions, run traces and shared Studio/chat service access.

Missing: repository bindings and GitHub Projects integration; issue/PR/check synchronization; ticket authoring and priority/dependency management; durable background monitoring and notifications; PR intake and isolated QA execution; GitHub review actions; merge coordination and progress reconciliation. Existing extraction/context gaps and live evaluation also remain open.

The current service is offline as checked on 2026-10-30. Starting it does not implement this workflow. Tools available to this Codex chat are not automatically capabilities of the manager process. The connector exposes issues/reviews/merge operations, but no GitHub Projects operations were found in its current tool catalog; choose and verify a supported Projects integration during design.

## Implementation criteria to resolve in design

- Bind every record and action to an explicit repository/project/issue/PR identity. Keep repo data separate; respect independent memory-bank boundaries in the agents collection.
- Define observed GitHub state versus inferred/planned work, preserving evidence and provenance without forcing the user to manually approve every observable issue/PR event. Do not remove the existing candidate-fact review rules implicitly.
- Specify ticket readiness, priority/dependency rules, completion criteria, and when a decision needs the user.
- Define persistent execution, restart recovery, event deduplication, synchronization and notification delivery. Do not rely on an active chat as the background service.
- Make QA report the reviewed commit, checks executed and results, missing evidence and actionable findings. Code updates invalidate stale QA outcomes. Test PR code in an appropriately isolated runner without exposing manager credentials.
- Verify GitHub identities, Projects permissions, review eligibility and branch rules. Gate merging on the current reviewed commit and required checks; avoid bypassing repository protections. Retries must not duplicate writes or claim unsuccessful merges.
- Demonstrate the complete ticket → PR → changes requested → updated PR → QA → merge → progress loop before describing the manager as ready. Assess planning/QA quality separately from transport and fixture correctness.

## Next concrete work

Design the expanded manager around this loop using the current service and explicit GitHub/QA interfaces. Start with repository/project binding, synchronized status and actionable tickets, then add PR QA and merge coordination, and finally persistent proactive operation. No implementation or external action occurred in this requirements capture.
