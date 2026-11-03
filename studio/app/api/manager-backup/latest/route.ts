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
      { error: "Backup is unavailable." },
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
      new Request("https://manager.internal/backup/latest", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-manager-actor": owner,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      }),
    );
    if (!response.ok) return error(503);
    const body = await response.arrayBuffer();
    if (body.byteLength > 8 * 1024 * 1024) return error(503);
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (
      !value ||
      typeof value !== "object" ||
      !("manager" in value) ||
      !("evidence" in value)
    )
      return error(503);
    return new Response(body, {
      headers: {
        ...noStore,
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=manager-backup.json",
      },
    });
  } catch {
    return error(503);
  }
}
