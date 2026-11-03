# Local Durable Object alarm and R2 probe

This fixture runs the real manager alarm handler and evidence object against Wrangler's local Durable Objects and local R2. All credentials and source material are fixed synthetic fixtures. **Never deploy this fixture or provide real data.** It accelerates the alarm only through a local-only testing endpoint; normal backup intervals remain unchanged.

From `project-manager/`, create a fresh temporary directory and prepare the synthetic pair:

```sh
stage2_alarm_dir="$(mktemp -d)"
node --import tsx tests/cloudflare/multiworker-check.ts prepare "$stage2_alarm_dir"
```

Start Wrangler using a new, disposable persistence directory:

```sh
WRANGLER_LOG_PATH="$stage2_alarm_dir/wrangler.log" ../studio/node_modules/.bin/wrangler dev --local -c tests/cloudflare/alarm-wrangler.toml --persist-to "$stage2_alarm_dir/state" --ip 127.0.0.1 --port 8795 --var FIXTURE_ACCESS:local-test-only --var MANAGER_SERVICE_TOKEN:fixture-service-token-0123456789-abcdefgh --var MANAGER_OWNER_ID:123456 --var MANAGER_MIGRATION_TOKEN:fixture-migration-token-0123456789-abcdef --var MANAGER_IMPORT_MODE:required --var BACKUP_ENABLED:true
```

In another terminal, run the checks:

```sh
node --import tsx tests/cloudflare/alarm-check.ts locked "$stage2_alarm_dir"
node --import tsx tests/cloudflare/alarm-check.ts import "$stage2_alarm_dir"
node --import tsx tests/cloudflare/alarm-check.ts rearm "$stage2_alarm_dir"
```

The locked check schedules an alarm before import and verifies an error status, an armed retry, and no R2 object. The import check imports the synthetic pair, schedules the real alarm, sends no requests while it fires, and verifies exact R2 readback and a future daily alarm. The rearm check schedules another alarm six seconds in the future. Stop Wrangler immediately after it returns; leave it stopped for at least seven seconds. Restart with the same command and directory, then run:

```sh
node --import tsx tests/cloudflare/alarm-check.ts inspect "$stage2_alarm_dir"
```

The import and inspect checks also download the last verified backup through the manager endpoint and compare it with the input. The inspect check verifies the overdue alarm produced a second backup, the latest status points to that object, its snapshot pair validates and its contents match the input. Stop Wrangler and remove the disposable directory afterward.

This tests local Workers scheduling and local R2 persistence, including a restart. It does not establish production R2 retention, account permissions, real-data recovery, costs, monitoring, or deployed alarm behavior.
