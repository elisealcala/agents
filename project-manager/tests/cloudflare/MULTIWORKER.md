# Local two-Worker import probe

This fixture uses only synthetic identities, source material, OAuth credentials and signing secrets. It generates two temporary Wrangler configurations and a private, synthetic snapshot pair. **Never deploy these configurations or use this fixture with real data.** The test uses the current Studio OpenNext build and manager source; rebuild Studio first if its source changed. A generated Auth.js session tests the owner checks, not GitHub OAuth.

From `project-manager/`, choose a fresh temporary directory and prepare the inputs:

```sh
stage2_multiworker_dir="$(mktemp -d)"
node --import tsx tests/cloudflare/multiworker-check.ts prepare "$stage2_multiworker_dir"
```

Start both Workers in one local runtime:

```sh
WRANGLER_LOG_PATH="$stage2_multiworker_dir/wrangler.log" ../studio/node_modules/.bin/wrangler dev --local -c "$stage2_multiworker_dir/studio.json" -c "$stage2_multiworker_dir/manager.json" --persist-to "$stage2_multiworker_dir/state" --ip 127.0.0.1 --port 8794
```

In another terminal, run:

```sh
node --import tsx tests/cloudflare/multiworker-check.ts init "$stage2_multiworker_dir"
```

The probe expects unauthenticated and wrong-owner sessions to be rejected, a cross-origin import to fail, and manager reads to be unavailable before import. It imports the pair using a synthetic owner session and then checks the exact evidence through the Studio proxy, both before and after an unauthenticated read attempt. Stop Wrangler and restart it with the same command and directory, then run:

```sh
node --import tsx tests/cloudflare/multiworker-check.ts inspect "$stage2_multiworker_dir"
```

The second check verifies that authenticated evidence reads still return the original reference, checksum and text after restart and that unauthenticated reads remain blocked. Stop Wrangler and remove the disposable directory after the run.

This exercises the built Studio route, Auth.js session decoding, and cross-script local Durable Object binding together. It does not verify actual GitHub OAuth, an HTTPS browser session, deployed Cloudflare bindings, real credentials or migration of user data.
