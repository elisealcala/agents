# Stage 2 private staging release

This is a release and recovery checklist, not evidence of a deployed application. The web Worker is configured for `https://project-manager.ezth.workers.dev`; the storage Worker has no public endpoint. Keep existing local manager and classifier processes stopped throughout the cutover. The approved 30-day expiration applies only to automatic objects under `manager-backups/`, not the original local backups.

## Reproducible local validation

The `Manager Cloudflare validation` GitHub Actions workflow installs each of the classifier, manager and Studio with its own frozen lockfile, runs manager and Studio checks, builds the checked-out Studio source for Cloudflare, and exercises the synthetic two-Worker import and alarm/R2 restart fixtures. The workflow publishes only a small JSON report containing the checked-out Git SHA, check names and result. Pull request runs identify the checked-out merge revision. No fixture database, backup, runtime log or credential is uploaded.

To repeat the bounded checks from a clean checkout with Node 22.22 and pnpm 10.9:

```sh
pnpm --dir ingest-classifier install --frozen-lockfile
pnpm --dir project-manager install --frozen-lockfile
pnpm --dir studio install --frozen-lockfile
pnpm --dir project-manager check
pnpm --dir project-manager test
pnpm --dir studio check
pnpm --dir studio cloudflare:build
pnpm --dir project-manager exec tsx tests/cloudflare/ci-check.ts
```

The runner refuses arguments, a dirty checkout and Cloudflare/Wrangler deployment environment settings. It starts only local Workers on loopback ports 8794 and 8795, checks fixture configuration, uses synthetic credentials and data, and removes its temporary state and processes. It requires those ports to be free. Optionally set `CI_REPORT_PATH` to a new file outside the checkout to save the non-sensitive report. These checks do not verify real OAuth, hosted bindings, deployment, retention or recovery. The next source prerequisite is #104; Stage 2 remains open until hosted acceptance.

## Before release

Delivery and backups share the manager Durable Object alarm. Once initialized, it wakes delivery every 60 seconds and processes at most five registered jobs or outbox operations per tick; no production delivery adapters are registered. Backup deadlines and retries are persisted separately and take precedence when earlier. This is approximately 43,200 alarm invocations per 30-day month for one continuously initialized object, before retries; account for them when checking Cloudflare costs. Batch limits cap operations and recovered rows; database query scan costs can grow with the size of the queue. Local synthetic restart checks do not prove hosted scheduling.

1. Confirm the account, worker names, R2 activation, account spending and the selected GitHub owner (`elisealcala`, numeric ID `16949569`). Confirm GitHub OAuth registration uses the selected HTTPS origin and the exact callback `/api/auth/callback/github`. GitHub sign-in grants no Projects or repository integration authority.
2. Preserve complete original database backups separately. The prepared copy and import file are described in the manager memory bank. Recheck that both original processes are stopped and that the snapshot pair is current and quiescent. Use `src/storage/backup-pair-cli.ts` and `src/storage/snapshot-export.ts` if a fresh pair is needed; never copy a live SQLite main file alone while ignoring its WAL.
3. Run the source checks, Cloudflare dry-run, synthetic cross-Worker test and alarm/R2 restart test. Build the exact reviewed release source and record its commit SHA. Confirm no real credentials or user backup files are in the release artifact or version control.
4. Verify the private Standard bucket `agents-manager-staging-backups` has no public access or custom public domain and its lifecycle rule expires only `manager-backups/` objects after 30 days. On 2026-11-03 the owner chose the free allowance with no spending limit or billing alert configured; review actual usage and alerting before release. The account-side checks are recorded in `docs/implementation/evidence/stage-2-r2.md`.
5. Configure secrets through the hosting provider's secret mechanism, never in repository files or command output. The storage Worker requires `MANAGER_SERVICE_TOKEN` and `MANAGER_MIGRATION_TOKEN`. The web Worker needs matching values plus `AUTH_SECRET`, `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`. Tokens must be distinct, random and at least 32 printable characters. Nonsecret owner ID, import mode, backup mode and canonical URL are in the Wrangler configs. Import and backup remain gated until their bindings and credentials exist.

## Deploy and validate

1. Deploy the storage Worker first, keeping its public endpoints disabled. Deploy the web Worker only after its secrets and the private Durable Object binding exist. Record Cloudflare account, revision, timestamp, configuration and actual URL. Do not put a model credential in a client bundle.
2. Open the website from a device without a checkout. Before import, confirm a signed-out browser cannot read the manager or its APIs, the configured owner can sign in, another GitHub identity cannot, and model/intake are unavailable rather than executing. Check responses use private/no-store and browser traffic never targets localhost.
3. As the owner, use **Restore backup** to upload the prepared paired JSON. Wait for completion; after an interrupted or unknown result, retry the same file. The durable marker keeps the manager locked until both stores verify. If the destination contains conflicting data, stop and investigate; never delete or replace it to make the import pass. Verify the project, source bytes/checksum, approved decisions, jobs and counts against the retained original backups.
4. Confirm an automatic backup fires, its status becomes successful, and the owner can download the verified file. Check the bucket is private and the 30-day rule is scoped correctly. Disable the web import control and remove the migration secrets after the successful cutover; keep the storage import-mode marker in place. Record release SHA and time to first backup.
5. Rehearse recovery with a **separate isolated storage Worker and web Worker**, each using separate names, Durable Object namespaces, secrets, test origin and OAuth callback. Restore a copy of a downloaded backup through its guarded import, compare note/evidence checksums, decisions and job state, and record recovery elapsed time. Do not point the drill at the active `primary` objects or the active bucket. Clean up temporary drill resources only after recording and verifying the result.
6. Verify sign-out, expired session, direct HTML/API denial, wrong identity, forged service context, CSRF/origin restrictions and readable backend outage handling. Inspect client bundles, screenshots and traces for secrets or raw exceptions. Verify private backup retention and notifications/monitoring appropriate to the account. Only then close Stage 2 issue #22 and record the acceptance evidence.

## Rollback

Keep the last known-good deployed revision and original complete SQLite backups. Stop the new owner and prevent requests before promoting an older compatible revision or restoring a backup to a separate owner. Do not start old and new manager owners simultaneously. A failed or partial paired import remains locked and may only resume with the same snapshot pair; preserve the lock and investigate rather than deleting it. Durable Object point-in-time recovery and R2 retention have different scopes; neither replaces the original classifier backup containing non-evidence tables.

## Staging private-boundary check

After deployment and before importing real data, the signed-in owner can run `studio/tests/manager/stage-2-boundary.js` in the browser console on the canonical staging origin. It prints only status and cache headers and sends one deliberately invalid cross-origin mutation probe. Do not share cookies, tokens, request bodies or private state. The pre-import lock means a generic project error alone does not establish a successful read or its cause; browsers may hide cross-origin responses. A separate non-owner GitHub identity is still needed for the real sign-in denial check. Record bounded results in `docs/implementation/evidence/stage-2-boundary.md`.
