import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { isHostedMode, isLoginConfigured } from "@/lib/manager-mode";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };
type Binding = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};
export async function GET(): Promise<Response> {
  const error = (status: number) =>
    Response.json(
      { error: "Backup status unavailable." },
      { status, headers: noStore },
    );
  if (!isHostedMode()) return error(404);
  if (!isLoginConfigured()) return error(503);
  const owner = process.env.MANAGER_OWNER_ID;
  const session = await auth();
  if (!owner || session?.user?.id !== owner) return error(401);
  const token = process.env.MANAGER_SERVICE_TOKEN;
  if (!token || token.length < 32) return error(503);
  try {
    const binding = (
      getCloudflareContext().env as unknown as { MANAGER?: Binding }
    ).MANAGER;
    if (!binding) return error(503);
    const response = await binding.get(binding.idFromName("primary")).fetch(
      new Request("https://manager.internal/backup/status", {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-manager-actor": owner },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      }),
    );
    if (!response.ok) return error(503);
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("configured" in data) ||
      typeof data.configured !== "boolean" ||
      !("latest" in data) ||
      !("next" in data) ||
      !("hasBackup" in data) ||
      typeof data.hasBackup !== "boolean"
    )
      return error(503);
    const latest = data.latest;
    if (
      latest !== null &&
      (!latest ||
        typeof latest !== "object" ||
        !("state" in latest) ||
        !["ok", "error"].includes(String(latest.state)) ||
        !("at" in latest) ||
        typeof latest.at !== "string")
    )
      return error(503);
    if (
      data.next !== null &&
      (typeof data.next !== "number" || !Number.isFinite(data.next))
    )
      return error(503);
    return Response.json(
      {
        configured: data.configured,
        hasBackup: data.hasBackup,
        latest:
          latest === null
            ? null
            : {
                state: (latest as { state: string }).state,
                at: (latest as { at: string }).at,
              },
        next: data.next,
      },
      { headers: noStore },
    );
  } catch {
    return error(503);
  }
}
