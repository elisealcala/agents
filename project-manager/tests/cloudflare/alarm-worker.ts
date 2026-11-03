/** Local-only alarm/R2 fixture; do not deploy or bind real data. */
import { DurableManagerObject } from "../../src/cloudflare/manager-object.ts";
export { DurableEvidenceObject } from "../../src/cloudflare/evidence-object.ts";

type FixtureEnv = {
  FIXTURE_ACCESS?: string;
  MANAGER_SERVICE_TOKEN: string;
  MANAGER_OWNER_ID: string;
  MANAGER_MIGRATION_TOKEN: string;
  MANAGER_IMPORT_MODE: string;
  BACKUP_ENABLED: string;
  MANAGER: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
  BACKUPS: {
    list(options: { prefix: string }): Promise<{ objects: { key: string }[] }>;
    get(key: string): Promise<{ text(): Promise<string> } | null>;
  };
};
type FixtureState = {
  storage: ConstructorParameters<typeof DurableManagerObject>[0]["storage"] & {
    setAlarm(at: number): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
};

export class FixtureManager extends DurableManagerObject {
  constructor(
    private readonly fixtureState: FixtureState,
    private readonly fixtureEnv: FixtureEnv,
  ) {
    super(fixtureState, fixtureEnv);
  }
  override async fetch(request: Request): Promise<Response> {
    if (this.fixtureEnv.FIXTURE_ACCESS !== "local-test-only")
      return new Response(null, { status: 404 });
    if (
      new URL(request.url).pathname === "/__fixture/schedule" &&
      request.method === "POST"
    ) {
      const delay =
        new URL(request.url).searchParams.get("delay") === "6000" ? 6000 : 200;
      await this.fixtureState.storage.setAlarm(Date.now() + delay);
      return Response.json({ ok: true });
    }
    return super.fetch(request);
  }
}
export default {
  async fetch(request: Request, env: FixtureEnv): Promise<Response> {
    if (env.FIXTURE_ACCESS !== "local-test-only")
      return new Response(null, { status: 404 });
    const path = new URL(request.url).pathname;
    if (path === "/objects" && request.method === "GET") {
      const listing = await env.BACKUPS.list({ prefix: "manager-backups/" });
      const objects = [];
      for (const { key } of listing.objects)
        objects.push({ key, body: await (await env.BACKUPS.get(key))?.text() });
      return Response.json({ objects });
    }
    const target =
      path === "/schedule"
        ? `/__fixture/schedule${new URL(request.url).search}`
        : path === "/status"
          ? "/backup/status"
          : path === "/latest"
            ? "/backup/latest"
            : path === "/import"
              ? "/migration/import"
              : null;
    if (!target) return new Response(null, { status: 404 });
    const headers = new Headers({
      authorization: `Bearer ${env.MANAGER_SERVICE_TOKEN}`,
      "x-manager-actor": env.MANAGER_OWNER_ID,
      "x-migration-token": env.MANAGER_MIGRATION_TOKEN,
      "content-type": "application/json",
    });
    return env.MANAGER.get(env.MANAGER.idFromName("synthetic-alarm")).fetch(
      new Request(`https://fixture.invalid${target}`, {
        method: path === "/status" || path === "/latest" ? "GET" : "POST",
        headers,
        body: path === "/import" ? await request.arrayBuffer() : undefined,
      }),
    );
  },
};
