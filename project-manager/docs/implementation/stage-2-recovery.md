# Stage 2 isolated restore and compatible rollback runbook

Results go in [evidence/stage-2-restore.md](evidence/stage-2-restore.md). Release context is in `deploy/README.md`.

## Rules (R1)

- Use a separate storage Worker, web Worker, Durable Object namespaces, secrets, test origin and OAuth callback. Never target the active `primary` objects.
- Never replace the active bucket. Restore from a *copy* of a downloaded backup; keep the original download and the complete original SQLite backups untouched.
- Only one manager owner may be active. Do not run old and new owners simultaneously.

## Drill steps

1. Record the drill resource names and the source backup identity (timestamp, size, SHA-256) before starting.
2. Deploy the drill storage Worker, then the drill web Worker, with import enabled only there.
3. Restore the copy through the guarded import. After interruption, retry only the same file.
4. Restart the drill Worker (R2). Verify: exact source/checksum; notes, evidence checksums, review decisions and job state against the source; the alarm is reinitialized and the import marker/lock state is as expected.
5. For rollback, deploy the last known-good compatible revision to the drill Workers and repeat the verification. Record its SHA.

## Record (R3)

Actual RPO, actual RTO, compatible revision, and limits (hosted vs synthetic). Reconcile any external effects. Only after verification, delete resources identified by name in the evidence file; delete nothing else.

## Limits

A local synthetic restore proves nothing about hosted recovery. Durable Object point-in-time recovery and R2 retention differ in scope and do not replace the original classifier backup.
