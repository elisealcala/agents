/** Runs synthetic local Workers only. Never pass deployment settings or real data. */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.argv.length !== 2) throw new Error("No arguments are accepted");
const forbidden = Object.keys(process.env).filter((key) =>
  /^(CLOUDFLARE_|CF_API_|WRANGLER_|MINIFLARE_)/i.test(key),
);
if (forbidden.length)
  throw new Error(`Deployment settings are forbidden: ${forbidden.join(", ")}`);
const root = path.resolve(import.meta.dirname, "../../..");
const manager = path.join(root, "project-manager");
const wrangler = path.join(root, "studio/node_modules/.bin/wrangler");
const tsx = path.join(manager, "node_modules/.bin/tsx");
const git = (...args: string[]) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Cannot determine source revision");
  return result.stdout.trim();
};
const revision = git("rev-parse", "HEAD");
if (!/^[a-f0-9]{40}$/.test(revision))
  throw new Error("Invalid source revision");
if (git("status", "--porcelain")) throw new Error("Checkout must be clean");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dir = await mkdtemp(path.join(tmpdir(), "manager-cloudflare-ci-"));
let worker: ChildProcess | undefined;
const env = {
  ...process.env,
  WRANGLER_LOG_PATH: path.join(dir, "wrangler.log"),
  CI: "true",
};
const run = async (command: string, args: string[]) => {
  const child = spawn(command, args, { cwd: manager, env, stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0)
    throw new Error(`Check failed: ${path.basename(command)} ${args[1] ?? ""}`);
};
const ensurePortFree = async (port: number) => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
};
const start = async (port: number, args: string[]) => {
  await ensurePortFree(port);
  worker = spawn(
    wrangler,
    [
      "dev",
      "--local",
      ...args,
      "--persist-to",
      path.join(dir, "state"),
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: manager, env, stdio: "ignore", detached: true },
  );
  let exited = false;
  worker.once("exit", () => {
    exited = true;
  });
  worker.once("error", () => {
    exited = true;
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (exited) throw new Error("Local Worker exited before readiness");
    try {
      await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1000),
      });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error("Local Worker did not become ready");
};
const stop = async () => {
  const child = worker;
  if (!child) return;
  worker = undefined;
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {}
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {}
    await exited;
  }
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void (async () => {
      await stop();
      await rm(dir, { recursive: true, force: true });
      process.exit(signal === "SIGINT" ? 130 : 143);
    })();
  });
}
const check = (script: string, phase: string) => run(tsx, [script, phase, dir]);
try {
  await check("tests/cloudflare/multiworker-check.ts", "prepare");
  for (const name of ["studio.json", "manager.json"]) {
    const config = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    if (
      config.workers_dev !== false ||
      config.preview_urls !== false ||
      config.routes ||
      config.route ||
      config.account_id
    )
      throw new Error("Unsafe fixture configuration");
  }
  const multiArgs = [
    "-c",
    path.join(dir, "studio.json"),
    "-c",
    path.join(dir, "manager.json"),
  ];
  await start(8794, multiArgs);
  await check("tests/cloudflare/multiworker-check.ts", "init");
  await stop();
  await start(8794, multiArgs);
  await check("tests/cloudflare/multiworker-check.ts", "inspect");
  await stop();
  await rm(path.join(dir, "state"), { recursive: true, force: true });
  const alarmConfig = await readFile(
    path.join(manager, "tests/cloudflare/alarm-wrangler.toml"),
    "utf8",
  );
  if (
    !/^workers_dev\s*=\s*false\s*$/m.test(alarmConfig) ||
    !/^preview_urls\s*=\s*false\s*$/m.test(alarmConfig) ||
    /^\s*(routes?|account_id)\s*=/m.test(alarmConfig)
  )
    throw new Error("Unsafe alarm fixture configuration");
  const alarmArgs = [
    "-c",
    "tests/cloudflare/alarm-wrangler.toml",
    "--var",
    "FIXTURE_ACCESS:local-test-only",
    "--var",
    "MANAGER_SERVICE_TOKEN:fixture-service-token-0123456789-abcdefgh",
    "--var",
    "MANAGER_OWNER_ID:123456",
    "--var",
    "MANAGER_MIGRATION_TOKEN:fixture-migration-token-0123456789-abcdef",
    "--var",
    "MANAGER_IMPORT_MODE:required",
    "--var",
    "BACKUP_ENABLED:true",
  ];
  await start(8795, alarmArgs);
  for (const phase of ["locked", "import", "rearm"])
    await check("tests/cloudflare/alarm-check.ts", phase);
  await stop();
  await sleep(7000);
  await start(8795, alarmArgs);
  await check("tests/cloudflare/alarm-check.ts", "inspect");
  await check("tests/cloudflare/alarm-check.ts", "delivery-seed");
  await stop();
  await sleep(7000);
  await start(8795, alarmArgs);
  await check("tests/cloudflare/alarm-check.ts", "delivery-inspect");
  await stop();
  const report = {
    revision,
    checks: [
      "two-worker import and restart",
      "alarm and local R2 restart",
      "delivery alarm restart",
    ],
    result: "passed",
    scope: "synthetic local fixtures; not hosted acceptance",
  };
  const output = process.env.CI_REPORT_PATH;
  if (output)
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
    });
  console.log(JSON.stringify(report));
} finally {
  await stop();
  await rm(dir, { recursive: true, force: true });
}
