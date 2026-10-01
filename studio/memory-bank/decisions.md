# Decisions — studio

## DEC-001: Next.js client of per-agent tRPC servers

Date: 2026-10-01
Status: accepted
Context: The studio lists agents and has to run them, edit prompts, read memory, and show tool calls. Agents in this collection stay independent processes.
Decision: The studio is a Next.js App Router app using shadcn/ui. It imports each agent's `AppRouter` type and calls that process over tRPC on localhost. It does not import `createIngestAgent` or run pipelines in the web process. The first server is `ingest-classifier`.
Consequences: A later agent in this studio is TypeScript and exports its own router. The shared UI is the trace tree. There is no second, untyped protocol.
