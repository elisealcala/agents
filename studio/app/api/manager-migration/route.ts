import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/auth";
import { isHostedMode, isLoginConfigured } from "@/lib/manager-mode";
import { isTrustedMutationOrigin } from "@/lib/manager-proxy-policy";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };
type Binding = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

/** Owner-only, same-origin bootstrap; the target is a fixed private Durable Object. */
export async function POST(request: Request): Promise<Response> {
  const error = (status: number, message: string) =>
    Response.json({ error: message }, { status, headers: noStore });
  if (!isHostedMode() || process.env.MANAGER_IMPORT_ENABLED !== "true")
    return error(404, "Not found.");
  if (!isLoginConfigured()) return error(503, "Sign-in is not configured.");
  const owner = process.env.MANAGER_OWNER_ID;
  const session = await auth();
  if (!owner || session?.user?.id !== owner)
    return error(401, "Sign in required.");
  if (
    !isTrustedMutationOrigin(
      request.headers.get("origin"),
      process.env.AUTH_URL,
    )
  )
    return error(403, "Request origin is not allowed.");
  const token = process.env.MANAGER_SERVICE_TOKEN;
  const migrationToken = process.env.MANAGER_MIGRATION_TOKEN;
  if (
    !token ||
    token.length < 32 ||
    !migrationToken ||
    migrationToken.length < 32 ||
    token === migrationToken
  )
    return error(503, "Import is not configured.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 8 * 1024 * 1024))
    return error(413, "Backup is too large.");
  let binding: Binding | undefined;
  try {
    binding = (getCloudflareContext().env as unknown as { MANAGER?: Binding })
      .MANAGER;
  } catch {
    return error(503, "Manager connection is unavailable.");
  }
  if (!binding) return error(503, "Manager connection is unavailable.");
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > 8 * 1024 * 1024)
      return error(413, "Backup is too large.");
    const response = await binding.get(binding.idFromName("primary")).fetch(
      new Request("https://manager.internal/migration/import", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-manager-actor": owner,
          "x-migration-token": migrationToken,
          "content-type": "application/json",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(35000),
      }),
    );
    if (!response.ok)
      return error(
        409,
        "Import could not be completed. Check the backup and retry the same file.",
      );
    return Response.json({ ok: true }, { headers: noStore });
  } catch {
    return error(503, "Import status is uncertain. Retry the same file.");
  }
}
