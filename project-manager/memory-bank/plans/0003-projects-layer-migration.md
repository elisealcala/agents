# Projects-only layer migration

Date: 2026-11-18
Status: approved for implementation and PR on `codex/projects-layer-migration`; verification pending.

## Goal and scope

Extract the local `projects.create`, `projects.list`, and `projects.get` feature into the user's proposed layers. Preserve existing API responses, persisted project aggregates, and the manager's single-owner transaction behavior.

At planning time the branch was `main`, and the six new files under `src/contracts`, `src/domain`, `src/services`, `src/infraestructure`, and `src/db/schema` were untracked placeholders. Rename `infraestructure` to `infrastructure` during implementation; preserve any user edits present at that time.

GitHub Projects (`src/integrations/github/projects.ts` and related routes), delivery, notes, extraction, review rules, conversations, runs, evaluations, authentication, and deployment behavior are outside this migration. Their existing calls into project persistence remain supported through a compatibility facade. Do not start the original local services or use the real hosted/local database for verification.

## Current owners

| Responsibility | Current location |
| --- | --- |
| `Project` aggregate type | `src/application/contracts.ts` |
| Creation defaults, project SQL, project table DDL | `src/storage/manager-store.ts` |
| Create/list/get input validation and handlers | `src/server/router.ts` |
| Database ownership and connections | `src/storage/store.ts`, `src/storage/durable-manager-store.ts` |
| Node / Durable Object transport startup | `src/server/main.ts`, `src/cloudflare/manager-object.ts` |
| Client compatibility | package `./server` and `./contracts` exports, Studio and MCP |

`Project` includes notes, candidates, approved facts, history, reviews, and conversations. Extracting its model must not discard these fields or turn get/list responses into summaries.

## Target responsibilities

| File | Responsibility |
| --- | --- |
| `src/domain/projects.ts` | Own `Project`, a pure factory for its current initial state, and name rules used by the new service. Accept the ID and timestamp as factory inputs. No SQL, tRPC, or provider calls. |
| `src/contracts/projects.ts` | Define the synchronous outbound `ProjectsRepository` port: `list(): Project[]`, `get(id: string): Project`, `save(project: Project): void`. Import the domain type with `import type`. |
| `src/services/projects.ts` | `ProjectsService.create/list/get`; validate/normalize creation names, obtain UUID/time through injectable defaults, construct the aggregate, and use the repository port. No imports from infrastructure or storage. |
| `src/infrastructure/projects.ts` | Implement `SqlProjectsRepository` over the existing `SqlDriver`. Own project queries, JSON serialization, and row/domain mapping. Receive an existing driver; never open a connection, perform startup recovery, or start a transaction in `save`. |
| `src/infrastructure/trpc.ts` | Own the shared tRPC initialization/context and the local projects subrouter. Handlers call `ctx.manager.projects`. Retain current Zod input validation and transport errors. |
| `src/db/schema/project.ts` | Export the existing project-table DDL and persistence row shape (`id`, `data`). This is a SQL schema module, not a new ORM or a runtime domain schema. |

Request path: projects tRPC handler → ProjectsService → ProjectsRepository port → SqlProjectsRepository → existing SqlDriver.

Keep the existing Zod dependency for boundary validation; a full Zod schema for the persisted aggregate is unnecessary for this extraction. Domain types and persistence rows have separate owners even while the database continues storing the aggregate as JSON.

## Compatibility and transaction bridge

- Keep `application/contracts.ts` as the public compatibility export for `Project`; its existing consumers should not all need import edits. The related models remain there for this slice. The new domain aggregate may reference those related models using type-only imports, with `Project` re-exported back using `export type`. This temporary type-only dependency is a partial-migration seam, not complete domain isolation; introduce no runtime import cycle.
- `ManagerStore` constructs one project adapter using its existing driver and exposes it through a readonly repository property. Initialize it before startup recovery reads projects.
- Keep `ManagerStore.create/list/get/save` as forwarding compatibility methods. Creation uses the same pure aggregate factory, preserving direct-store name behavior; the new service owns normalization for its application entry point. Existing fixtures, evaluations, notes, and reviews continue to work.
- Keep `ManagerStore.commit(project, run)` as the transaction owner. Its project save and run save use the same driver and the same synchronous transaction. The repository must not create a nested transaction or obtain another database connection.
- `Manager` exposes a `ProjectsService` built once from the store's repository, alongside its existing orchestration methods. Both Node and Durable Object startup already construct `Manager`; they inherit the same wiring without constructing another store.
- Move shared tRPC initialization/context mechanically to `infrastructure/trpc.ts` and export the shared `t` instance plus the projects subrouter. `server/router.ts` imports them, keeps all other routers/middleware, and still exports `appRouter` and `AppRouter`. The infrastructure module must not import `server/router.ts` at runtime.

## Implementation sequence

### 1. Define the project boundary

- Rename the placeholder infrastructure directory.
- Implement `domain/projects.ts`, `contracts/projects.ts`, and the type compatibility export in `application/contracts.ts`.
- Preserve all aggregate fields and defaults: UUID ID, supplied name, revision zero, ISO creation time, and the six existing empty collections.
- Keep the factory deterministic with supplied ID/time. Add no new project operations such as update/delete, ownership, uniqueness, or pagination.

Check: manager typecheck still resolves old imports; domain-focused cases cover the complete initial aggregate and the existing trim/nonempty/200-character creation-name rules.

### 2. Extract persistence while retaining the facade

- Implement `db/schema/project.ts` and `infrastructure/projects.ts`.
- Update `storage/manager-store.ts` to use the project DDL within its existing schema initialization transaction and delegate project persistence to the adapter.
- Preserve `projects(id TEXT PRIMARY KEY, data TEXT NOT NULL)`, current migration versions, JSON representation, and `ORDER BY rowid DESC` list behavior. Use the current upsert semantics so saving a record does not reorder it.
- Keep project reads detached from persisted state, retain `Unknown project`, and leave generic run/evaluation storage and recovery behavior intact.

Check: synthetic Node and Durable Object-driver tests cover round-trip of populated aggregates, list order after updates, detached reads, unknown IDs, and reopening existing data. Reuse the existing forced-run-failure test to prove a project update still rolls back with its run.

### 3. Add application use cases

- Implement `services/projects.ts` against the port, with injectable UUID/time functions for deterministic verification.
- Add `Manager.projects` in `application/manager.ts`, initialized once from the existing store's project repository.
- Preserve create/list/get return shapes and missing-project behavior. Do not move note/review/conversation use cases into the new service.

Check: focused service tests use an in-memory port implementation to cover creation defaults, invalid names, list/get delegation, and missing-project propagation. Verify service imports do not reach SQL or tRPC.

### 4. Route the existing API through the service

- Implement `infrastructure/trpc.ts` using the same context and tRPC instance for both the extracted and remaining routers.
- Replace only the local `projects` block in `server/router.ts` with the extracted subrouter.
- Preserve the `projects.create/list/get` paths, name trimming/limits, UUID input validation, error codes/messages, `AppRouter` type inference, and existing authentication boundaries. Do not convert an unknown-project error into a new transport code in this refactor.
- Keep package exports and the MCP/Studio client imports intact. No changes to `server/main.ts` or `cloudflare/manager-object.ts` should be required with the `Manager.projects` bridge.

Check: existing router, degraded-configuration, MCP, and Durable Object tests still call the same API without new context requirements. Studio typecheck confirms inferred client compatibility.

### 5. Complete verification and record the result

- Use the test-writer for necessary coverage changes and the verifier for final checks, following this agent's instructions.
- Run manager typecheck, lint, format check, and tests. Run Studio typecheck because it consumes `AppRouter` and the public contracts. Exercise the existing local Cloudflare validation fixtures against disposable synthetic state when persistence/wiring changes land; do not deploy.
- Check snapshot/backup-pair tests: table definitions, migration versions, serialized aggregate fields, and old-data readback must remain compatible. No SQL data migration or schema version bump is intended.
- Inspect the final diff for projects-only scope, update this bank, and report verification separately from hosted acceptance. The subsequent implementation request authorizes commit/push and opening a PR; deployment and merge remain outside scope.

## Completion criteria

- The three local project endpoints traverse the new service and repository port.
- Domain factory, repository port, service, SQL adapter, tRPC adapter, and project SQL schema have the target owners above.
- Existing callers can still use `ManagerStore` and public imports during the partial migration.
- Project/run commits remain atomic, startup recovery still works, and both database drivers use the same adapter implementation.
- Existing project data and API contracts remain compatible; no other feature is migrated.

## Planning-session verification

The current implementation and relevant compatibility/rollback tests were inspected. No product code was changed, no test suite was run, no services were started, and no database or deployment was modified. Implementation recommendations remain proposed.

Independent documentation verification passed: source/path claims, proposed scope, transaction/recovery and API/type compatibility constraints, existing rollback coverage, and whitespace. No material findings; product checks were skipped because this task changed documentation only.

## Implementation verification — 2026-11-18

Runtime extraction is implemented on `codex/projects-layer-migration`, following DEC-015. The test-writer's focused run passed 32 tests. Independent verification passed manager typecheck/lint/format, Studio typecheck, whitespace, and code review with no material findings. The restricted full manager run passed 325/333; eight MCP cases were blocked by localhost listener permissions. A listener-enabled MCP rerun passed 20/20, covering all 333 current tests across those runs. The Studio Worker build and clean-checkout local Cloudflare probes remain pending before PR publication.
