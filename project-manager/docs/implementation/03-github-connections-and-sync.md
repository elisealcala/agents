# Stage 3 — GitHub connections, inventory and Projects

Status: Planned. Depends on [Stages 1–2](README.md#stages-and-dependencies). Next: [Stage 4](04-conversations-planning-and-tickets.md).

## Outcome

Through the hosted setup UI, connect the two repositories, authorize personal Projects access and inspect the imported backlog. Reuse existing suitable boards or create one per repo when needed. The dashboard shows observed work, freshness and integration health, with source links.

## Implementation slices

| Ticket | Owned paths, proposed unless existing | Deliverable and dependency |
| --- | --- | --- |
| PM-301: GitHub connection boundary | `src/integrations/github/{client,identity}.ts`, authenticated settings routes/UI | Browser App install/callback flow and repo capability checks; separate owner Projects authorization. Store secrets encrypted/server-side; verify account/installation/repo identities. |
| PM-302: Inventory and observations | `src/integrations/github/{issues,pulls,sync}.ts`, delivery projection/store | Paginated snapshots of issues/PRs/checks/reviews, overlapping cursors and durable reconciliation; no automatic prose fact approval. Depends on PM-301. |
| PM-303: Personal Projects adapter | `src/integrations/github/projects.ts`, binding/command schema | Discover/adopt/create Project, fields/options and issue items as independently recoverable operations. Preserve existing boards/fields. Depends on PM-301/302. |
| PM-304: Connection and status UI | `studio/components/manager/{connections,repository-inventory,sync-health}.tsx`, settings/project routes | Show connected repos, Project choices, capability checks, observed work and reauthorization/retry. Depends on PM-302/303. |
| PM-305: Reconciliation failures | Provider doubles, isolated capability tests, delivery integration tests | Recover rate limits, revoked tokens, partial GraphQL failures, missing pages, restart, duplicate events and unknown creates. Depends on earlier slices. |

## Important boundaries

The browser signs in separately from granting integrations. Personal Projects use documented owner-authorized access; repository App permissions do not imply user Project access. Provide a secure browser credential/setup flow, masked status, rotation and disconnection. Provider-console steps may require browser authorization; no CLI token generation or local `.env` editing is a user prerequisite. The runtime never borrows this Codex chat's connector session.

Inventory before creation. Persist immutable repo/Project/item/field IDs and the source/time of every observed value. Recover Project creation through a creation-time durable marker or stop on ambiguity. Create fields, insert items and update fields in separate recorded steps. Connection tests may read real capabilities; isolated test objects used for mutation tests must be clearly labelled and cleaned up without touching existing user work.

Writes here cover configured Project provisioning/projection only. Ticket generation, formal QA reviews and merging remain disabled. Import authoritative GitHub state into the observed lane; preserve pending Markdown candidates. Unknown-actor remote edits remain conflicts instead of becoming invented human decisions.

## Browser acceptance

Install/connect the App through GitHub, return to setup, select `chore-design` and `agents`, authorize Project access, inspect discovered boards, adopt or create a mapped board, and see work linked to the correct repo. Revoke authorization externally: the UI shows a connection blocker, timestamped last-known state and a reconnect action. Reconnect and resume without duplicate boards/items.

## Verification and exit gate

- Real read/provisioning capability checks pass with the configured identities for both repos. Unsupported access remains disabled and explained.
- Repo A's issue number cannot select repo B's work; status displays source/freshness and preserves existing user edits.
- Unknown create outcomes reconcile before retries; multi-page fetches/GraphQL partial errors cannot silently omit work or advance a cursor too early.
- Restart/offline recovery neither deletes imported work nor fabricates completion. Browser setup and rotation journeys pass on staging.

Exit: two correct repo bindings and Project mappings, dependable read-only observed work and browser-managed connections. Rollback: disable sync/writes and retain mappings/operation receipts; detach only manager-owned integration configuration, preserving GitHub issues/boards.
