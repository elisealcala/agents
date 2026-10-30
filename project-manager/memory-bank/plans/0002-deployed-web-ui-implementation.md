# Deployed web UI implementation plan

Date: 2026-10-30. Status: planned, no runtime implementation started.

User requirement: the manager has a deployed web UI; daily conversations, planning, QA inspection, decisions and recovery do not require terminal interaction. Commit the accepted system design, then organize implementation files and work by phase.

Canonical plan: [docs/implementation/README.md](../../docs/implementation/README.md), with eight stage documents. Design baseline was committed locally as `52b7dae`; no remote push was requested.

1. Delivery contracts, durable state and manager UI shell.
2. Owner sign-in, same-origin BFF, private hosted staging, data volumes/backups and browser setup.
3. GitHub connections, existing-work inventory, Project provisioning/adoption and synchronization.
4. Direct conversations, typed decisions, priorities, blockers and ready tickets.
5. PR intake, independent isolated QA and evidence UI.
6. Formal reviews, protected conditional merging and accurate progress.
7. Meaningful proactive contact, private inbox and browser operations.
8. Actual two-repo production pilot, quality/recovery evidence and release.

Each stage defines ticket-sized slices, proposed file ownership, dependencies, browser acceptance, verification, exit and rollback. PM-101 etc. are planning IDs, not created GitHub tickets. Runtime source files are created when a slice implements behavior; no empty future scaffolds are generated now.

Preserve independent manager/Studio/classifier ownership. This task does not read/change other component memory banks; future implementers must follow their applicable bank loop when changing those components. Reuse Studio as the UI instead of creating a new collection agent. Choose real hosting/account/domain/budget and runner profiles during their stage, then verify actual operation rather than claiming implementation from plan files.
