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
Status: accepted
Context: User clarified the request was for system design, not implementation.
Decision: Remove the unrequested workspace/router dependency/registry additions. Treat the independent-manager workspace as a future proposal until implementation is requested.
Consequences: Studio runtime remains as before this request. DEC-002 records an abandoned implementation and is not active.
