# Decisions — studio

## DEC-001: Next.js client of per-agent tRPC servers

Date: 2026-10-01
Status: accepted
Context: The studio lists agents and has to run them, edit prompts, read memory, and show tool calls. Agents in this collection stay independent processes.
Decision: The studio is a Next.js App Router app using shadcn/ui. It imports each agent's `AppRouter` type and calls that process over tRPC on localhost. It does not import `createIngestAgent` or run pipelines in the web process. The first server is `ingest-classifier`.
Consequences: A later agent in this studio is TypeScript and exports its own router. The shared UI is the trace tree. There is no second, untyped protocol.

## DEC-002: Dedicated project-manager workspace
Date: 2026-10-01
Status: superseded
Context: Project collection and supervisor analysis differ from classifier operations.
Decision: Register project-manager on port 8788 and import its router type into a dedicated workspace; reuse TraceView.
Consequences: Studio remains a client of independent servers. Local registry overrides must include the new entry.

## DEC-003: Project-manager integration is design only
Date: 2026-10-01
Status: superseded
Context: User clarified the request was for system design, not implementation.
Decision: Remove the unrequested workspace/router dependency/registry additions. Treat the independent-manager workspace as a future proposal until implementation is requested.
Consequences: Studio runtime remains as before this request. DEC-002 records an abandoned implementation and is not active.

## DEC-004: Typed review-first project-manager workspace
Date: 2026-10-05
Status: accepted
Context: The user explicitly requested implementation of the accuracy-first manager plan, including Studio note intake, review, grounded chat and evaluation inspection.
Decision: Register the independent project-manager server on port 8788 using an optional registry kind, with omitted kinds retaining classifier behavior. Import its router as a type, keep project selection keyed to reset local state, and reuse the existing TraceView.
Consequences: Studio proposes no state changes itself. It sends versioned review decisions to the manager, displays precise citations and human confirmations, polls persisted run state, and exposes evaluation reports read-only. Existing local registries must opt into the manager entry.

## DEC-005: Generate Next.js types before standalone typechecking
Date: 2026-10-05
Status: accepted
Context: GitHub CI runs checks before the production build on a clean checkout. Root layout uses Next.js's generated LayoutProps helper, while local dev/build artifacts masked the missing generation step.
Decision: Run `next typegen && tsc --noEmit` in the typecheck script, following the installed Next.js CLI guide. Keep framework-generated type helpers and generated files ignored.
Consequences: All callers of typecheck/check, including CI, generate route/layout types before TypeScript. Verify in a fresh temporary copy without .next, next-env.d.ts or incremental compiler state, preserving the live development server's files.
