# Implementation plan: deployed project manager with a web UI

Date: 2026-10-30. Status: implementation-ready plan; runtime changes have not started.
Design baseline: local commit `52b7dae`, [system design](../github-delivery-system-design.md), [workflow validation](../github-delivery-workflow-validation.md), DEC-008 and DEC-009.

## Product outcome

Open a private website, sign in, and manage `elisealcala/chore-design` and `elisealcala/agents` through the project manager. Discuss priorities, get a ready GitHub ticket, hand it to Codex, follow independent QA and corrections, see merge/progress evidence, and respond to meaningful blockers or ideas. The deployed service continues working when the browser is closed and the user's laptop is asleep. Daily use requires no terminal, MCP registration, local service startup or JSON editing.

GitHub remains the issue/PR work surface. The manager website is the conversation, planning, QA evidence, decisions and operations surface. One-time GitHub authorization and infrastructure account setup use browser flows; developer deployment/recovery tooling may use commands, while product users get corresponding status and recovery actions in the UI. Do not expose infrastructure commands or stack traces as the product's required next action.

## Architecture to implement

- Reuse `studio/`'s Next.js/React UI and existing manager components. Add a manager-specific `/manager` application; the hosted entry redirects there. Preserve the local collection UI for development without publishing arbitrary classifier administration or local agent URLs.
- Keep `project-manager/` as the independent TypeScript/tRPC application and the only owner of its SQLite database. Extend its storage, observed-state/decision APIs and persistent orchestration; Studio never imports or opens its Store.
- Browser requests use authenticated same-origin Next.js routes. A server-only BFF (backend for frontend) forwards allowlisted manager operations over a private network with service authentication and verified actor context. The browser never contacts `127.0.0.1:8788`, stores provider credentials or chooses an arbitrary backend URL.
- Use GitHub sign-in through a maintained Auth.js integration, allowlisting the configured owner's immutable account ID. Authenticate server routes/mutations independently of navigation guards. Sign-in access is separate from App installation and owner Projects authorization.
- Deploy one persistent manager instance, one Studio instance and a dedicated classifier sidecar on an always-on Linux VM/container host behind HTTPS. Use persistent volumes and encrypted off-host backups. QA executes in separate disposable VMs/microVMs, without a control-plane mount, socket or write credential.
- Use one GitHub App installation for the two repo integrations and eligible bot reviews/merges, plus separately authorized personal Projects access. One private inbox and public-safe bot coordination-issue mentions deliver attention; external heartbeat monitoring detects host failure.

This follows the [Next.js self-hosting model](https://nextjs.org/docs/app/guides/self-hosting) and [Auth.js protected route/session model](https://authjs.dev/getting-started/session-management/protecting). Resolve and pin maintained compatible dependency versions during their stage; this plan does not install or assume new packages exist.

## Stages and dependencies

Every stage is a releasable increment with explicit capability flags. Earlier increments stay usable while later capabilities are disabled. No phase is complete merely because its API works in a terminal.

| Stage | Phase | Browser-visible outcome | Depends on | Requirement areas |
| --- | --- | --- | --- | --- |
| [1](01-foundation-and-ui.md) | Contracts, durable state and UI foundation | Navigate projects, conversation, work, inbox and activity; retain current note review/evidence | Committed design | R01, R02, R14, R15 |
| [2](02-private-deployment-and-access.md) | Private hosted app and access | Sign in at a real HTTPS URL; finish setup and inspect service health | 1 | R02, R14 |
| [3](03-github-connections-and-sync.md) | GitHub connections, inventory and Projects | Connect both repos, adopt/create boards, see accurate read-only work and synchronization state | 1, 2 | R01, R06, R09, R14 |
| [4](04-conversations-planning-and-tickets.md) | Conversations, priorities and ready tickets | Discuss next steps, resolve blockers and receive a useful ticket URL | 3 | R02–R08, R15 |
| [5](05-independent-qa.md) | PR intake and independent QA | Follow testing, inspect criteria/evidence and see pass/changes/inconclusive results | 3, 4; runner capacity | R09–R11, R14, R15 |
| [6](06-reviews-merges-and-progress.md) | Formal reviews, protected merge and progress | See change requests/approval, eligible merges, remaining work and next tickets | 5; real review/rule checks | R11–R14 |
| [7](07-proactive-operation.md) | Proactive attention and browser operations | Receive meaningful alerts; acknowledge, snooze, reconnect or retry from UI | 2–6 | R04, R05, R14 |
| [8](08-production-pilot-and-release.md) | Complete production pilot and release | Finish the whole workflow across both repos without terminal interaction | 1–7 | R01–R15 |

Stage 2 creates a private staging deployment early. Stage 4 is the first useful hosted planning release. Stage 5 adds QA while merge remains disabled. Stage 6 permits eligible merges only in a controlled staging/pilot exercise with the user present; unattended production merging additionally requires Stage 7 attention/health/budget gates and Stage 8 quality acceptance. Stage 8 is the full production acceptance gate. Deploy incrementally; do not defer hosting or all browser tests until the final stage.

## UI information architecture

| Route group | Main user job | What it must show |
| --- | --- | --- |
| `/manager` | What needs attention now? | Both repos, current priority, next ready work, blockers, sync health and pending decisions |
| `/manager/conversations` | Talk directly with the manager | Explicit repo/portfolio scope, persisted conversation, sourced status, decision receipts and action outcomes |
| `/manager/projects/[projectId]` | Understand one repo | Goals, ordered backlog, dependency blockers, GitHub board links and progress |
| `/manager/work/[workItemId]` | Pick up a ticket | Problem, scope, criteria, rationale, dependencies, verification recipe, current revision and Copy ticket link |
| `/manager/pull-requests/[bindingId]` | Follow QA and delivery | Current PR version, criteria coverage, findings, artifacts, review/merge result and remaining ticket work |
| `/manager/inbox` | Respond to the manager | Blockers, decisions and ideas with evidence, choices, acknowledgement and snooze |
| `/manager/activity` | Explain what happened | Human decisions, agent actions, API outcomes, current jobs and readable failure explanations |
| `/manager/settings` | Connect and operate | GitHub connections, repo/Project mappings, delegation/pause, budgets, notification test and service health |

Use responsive layouts, keyboard access and readable empty/loading/error/stale states from Stage 1. Technical traces are expandable evidence, not the primary workflow. Feature flags explain unavailable capabilities by current stage. Do not show a successful connection or merge solely because a request was queued.

## Proposed file ownership

All runtime paths listed here and in stage files are proposed until the relevant implementation ticket creates them. Create the exact modules when their first behavior and tests are implemented; do not generate empty placeholders for later phases.

| Area | Existing code to reuse | Proposed extension |
| --- | --- | --- |
| State/contracts | `project-manager/src/application/contracts.ts`, `src/storage/store.ts` | `src/delivery/contracts.ts`, `src/storage/migrations/`, `src/storage/delivery-store.ts` |
| Durable orchestration | `src/application/manager.ts`, `src/server/router.ts` | `src/delivery/reducer.ts`, `jobs.ts`, `outbox.ts`, `policies.ts`, `src/server/delivery-router.ts` |
| Web product | `studio/components/project-manager-workspace.tsx`, `studio/lib/project-trpc.tsx` | `studio/app/manager/`, `studio/components/manager/`, same-origin client |
| Authentication/BFF | Existing Next.js server | `studio/auth.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/api/manager/[...path]/route.ts`, `studio/lib/manager-server.ts`; manager `src/server/auth.ts` |
| GitHub | Existing typed provider pattern | `src/integrations/github/{client,identity,projects,issues,pulls,sync}.ts` |
| Planning | Existing evidence/model boundary | `src/planning/{context,planner,readiness,dependencies,decisions}.ts` |
| QA | Existing run/trace concepts | `src/qa/{contracts,coordinator,profiles,reports,runner-client}.ts`; trusted supervisor under `qa-runner/` owned by the manager |
| Reviews/merge | GitHub adapter and durable outbox | `src/delivery/{reviews,merge,completion}.ts` |
| Attention/operations | Run diagnostics | `src/notifications/{inbox,policy,delivery}.ts`, `src/operations/{health,budgets}.ts` |
| Deployment | No current manager deployment | `project-manager/deploy/{compose.yaml,Caddyfile,README.md}`, manager/Studio/classifier image build instructions and scoped CI workflow |
| Acceptance | Existing manager tests and design model | `project-manager/tests/delivery/`, `studio/tests/manager/`, isolated GitHub/QA fixtures and release evidence |

The Studio and classifier remain independent components. Before actually modifying either component, its implementing agent follows that component's AGENTS/session protocol. This planning task owns only the project-manager bank; no other bank is read or changed. The QA supervisor is an internal manager subsystem, not a newly registered collection agent.

## Work and review discipline

- Split each stage into its listed ticket-sized slices. An issue includes the design link, prerequisite ticket IDs, owned paths, behavior/criteria, browser journey, verification and rollback. Only the next dependency-ready slices are Ready; future phases stay Planned.
- Each slice includes backend behavior, the associated UI state and appropriate verification. User/Codex own implementation through PR. The manager/QA workflow may initially require human review while its own features are being built; do not pretend the future system already runs its bootstrap work.
- Use unit/contract tests for reducers, permissions and provider mapping; integration tests for persistence/HTTP and recoveries; Playwright browser flows for the hosted product; isolated real GitHub capability checks before writes/merge automation. Reuse the 41-case design model as a scenario inventory, then translate relevant cases into actual component/integration tests.
- Preserve old note review/approved facts and immutable evidence. Use versioned migrations and recorded rollback/restore steps. Distinguish feature rollback from database restoration and never repeat confirmed external actions after a rollback.
- New UI/backend code passes the relevant package typecheck, lint, scoped tests and production build before release. Do not rerun unrelated suites for documentation alone. Validate changed classifier contracts independently if integration work actually changes them.

## Deployment and release policy

Use development → private staging → production. The first target is a single persistent Linux host, avoiding a database/runtime rewrite while the pilot is small. The vendor, domain, region, budget and credential values are activation inputs; select them before Stage 2 creates infrastructure. A static-only frontend host is insufficient for the independent SQLite owner and persistent orchestration. No provider purchase, resource creation, DNS change or deployment occurs in this planning task.

Build images from the repository root where local package dependencies are available; each package retains its own lockfile/install boundary. Do not assume `project-manager/` can build alone while its `file:../ingest-classifier` dependency is missing. Never copy `.env`, `.data`, host GitHub credentials or development agent registries into images. Supervisor restarts preserve mounted state and use liveness/readiness probes; deployments drain work and run migrations with exactly one database owner.

GitHub Actions or equivalent CI validates PRs and produces immutable versioned images. Controlled releases deploy them to staging, run browser smoke tests, then promote to production through a protected deployment environment. The release can be initiated/observed through a browser; the owner does not run server commands. Schema changes require backup/restore rehearsal. QA credentials, App/Projects secrets, data storage and health alerts are separate from untrusted candidate execution.

Initial proposed objectives to confirm during Stage 2: alerts for host outage within 5 minutes, recovery-point objective at most 24 hours for daily snapshots, recovery-time objective at most 4 hours through the operator runbook. These are targets to prove with drills, not availability promises. Retention and actual storage/runner/model spend limits must be set before enabling real workloads.

## What is created in this task

This index and eight stage files are implementation planning artifacts, together with a bank decision and a pointer plan. Runtime modules, UI routes, infrastructure and GitHub implementation tickets are not created yet. The first coding work is Stage 1's contracts/persistence/UI vertical slices. Implementation can proceed ticket by ticket from these files without rediscovering the workflow or requiring the user to manage a local service.
