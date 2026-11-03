# Local Cloudflare storage probe

This fixture runs the real delivery store, SQL driver and private manager tRPC service in Wrangler's local Workers runtime with SQLite-backed Durable Objects. The service, delivery and evidence probes use separate object IDs. The evidence probe calls the classifier-owned durable evidence store. It uses synthetic records only. It does not create Cloudflare resources or validate production deployment, real GitHub authentication, existing-data migration, or a hosted backup and restore.

The Worker returns 404 unless the explicit `FIXTURE_ACCESS=local-test-only` variable is supplied. The committed configuration contains no enabling variable, has no routes, and disables the workers.dev endpoint. **Never deploy this fixture or set that flag outside local development.** Its `init` and `recover` actions mutate its synthetic database; use a fresh disposable persistence directory for every run. Port 8793 is fixed in the checker to prevent it from targeting another server.

From `project-manager/`, start with a fresh temporary directory and first check that the fixture is disabled. `pnpm dlx` downloads the pinned Wrangler version if it is not already cached.

```sh
stage2_probe_dir="$(mktemp -d)"
pnpm dlx wrangler@4.154.0 dev --local --config tests/cloudflare/wrangler.toml --persist-to "$stage2_probe_dir" --ip 127.0.0.1 --port 8793
```

In a second terminal, run `node tests/cloudflare/check.mjs disabled`: it must print `disabled: passed`. Stop Wrangler with Ctrl-C. Start the same fixture and persistence directory with the explicit local-only flag:

```sh
pnpm dlx wrangler@4.154.0 dev --local --config tests/cloudflare/wrangler.toml --persist-to "$stage2_probe_dir" --ip 127.0.0.1 --port 8793 --var FIXTURE_ACCESS:local-test-only --var MANAGER_SERVICE_TOKEN:fixture-service-token-0123456789-abcdefgh --var MANAGER_OWNER_ID:123456
```

In the second terminal, exercise the delivery probe and the separate private manager service. The credentials below are fixed synthetic fixtures, not real secrets. The service tests first reject an unsigned request, then check the authenticated configuration and create a synthetic project:

```sh
node tests/cloudflare/check.mjs init
node tests/cloudflare/check.mjs service-unauthorized
node tests/cloudflare/check.mjs service-config
node tests/cloudflare/check.mjs service-create
node tests/cloudflare/check.mjs evidence-init
node tests/cloudflare/check.mjs binding-unauthorized
node tests/cloudflare/check.mjs binding-create
node tests/cloudflare/check.mjs snapshot-init
node tests/cloudflare/check.mjs hosted-evidence-init
node tests/cloudflare/check.mjs migration-init
```

Then stop Wrangler. Start it again with the same flag and directory and run:

```sh
node tests/cloudflare/check.mjs inspect
node tests/cloudflare/check.mjs recover
node tests/cloudflare/check.mjs service-inspect
node tests/cloudflare/check.mjs evidence-inspect
node tests/cloudflare/check.mjs binding-read
node tests/cloudflare/check.mjs snapshot-inspect
node tests/cloudflare/check.mjs hosted-evidence-inspect
node tests/cloudflare/check.mjs migration-resume
```

Each step prints `passed` only after checking the response. The initial request verifies that a duplicate outbox operation rolls back the repository transition: the repository remains at revision 1 with one dispatching intent. After restart, `inspect` verifies those records persisted. `recover` verifies the expired attempt becomes `unknown` and a stale completion is rejected; it must not silently retry or claim success. The `service-inspect` check verifies that the authenticated synthetic project is still present after restart. The evidence checks use one synthetic Unicode source: repeated registrations must return the same reference, changed content under the same key or source version must fail, another project cannot read it, and chunk offsets must preserve valid text. After restart, the source ID, generated reference, SHA-256 checksum and exact content must match the marker saved at initial registration. Stop Wrangler and remove the disposable directory when finished.

The fake adapter in this fixture performs no GitHub operations. The separate Node tests cover driver edge cases; this probe does not replace those tests.

The binding checks invoke Studio’s real private transport against the fixture’s real Durable Object binding: an incorrect actor is rejected, an authorized mutation creates a separate synthetic project, and a read after restarting Wrangler verifies persistence. They do not exercise the Next.js route, GitHub OAuth, or a cross-script production binding.

The snapshot checks use four separate synthetic Durable Objects, one source and one destination for each of the manager and evidence stores. A tampered snapshot must be rejected without changing the empty target digest; a valid restore must succeed, and after restarting Wrangler source and target digests must match. This verifies the current snapshot functions against the local Workers SQLite runtime only. It does not transfer actual data, test an import route or orchestration, include platform key-value data or alarms, or establish backup retention and disaster recovery.

The hosted-evidence probe stores a synthetic source and linked manager note in separate objects, then calls the actual manager tRPC endpoint through a private binding to the actual evidence object. It checks unauthorized and cross-project rejection and repeats the read after Wrangler restarts. The local namespace wrapper maps the evidence binding to its fixture object; this does not validate deployed cross-script bindings, real GitHub sign-in or a migrated source.

The migration probe uses separate synthetic source and destination objects and a fixed fixture-only migration token. `migration-init` verifies required-mode access stays locked, a wrong token is rejected, and a deliberately lost acknowledgement after evidence restore leaves the manager locked. After restarting Wrangler, `migration-resume` retries the same pair, verifies it unlocks, and reads the exact source through the real private endpoints. Restart once more and run `node tests/cloudflare/check.mjs migration-inspect` to check that completed state remains usable. These are same-script local Workers tests only; they do not verify the hosted cross-script binding, real OAuth or migration of user data.

The `multiworker-check.ts` fixture exercises the built OpenNext web Worker and the separate storage Worker together, using synthetic Auth.js sessions and a disposable persistence directory. After building Studio, prepare a fresh temporary directory with `pnpm exec tsx tests/cloudflare/multiworker-check.ts prepare <absolute-temp-directory>`, then run `wrangler dev -c <directory>/studio.json -c <directory>/manager.json --local --persist-to <directory>/state --ip 127.0.0.1 --port 8794` using the installed Wrangler. Run `pnpm exec tsx tests/cloudflare/multiworker-check.ts init <directory>`, stop Wrangler, restart it with the same arguments and run the checker with `inspect`. Stop the fixture and remove the disposable directory afterward. It checks unauthenticated and wrong-owner rejection, origin protection, import, exact evidence and persistence after restart. The session and secrets are synthetic; the fixture does not exercise GitHub OAuth or a deployed environment.
