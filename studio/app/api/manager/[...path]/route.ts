import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isHostedMode, isLoginConfigured } from "@/lib/manager-mode";
import { sanitizeManagerPayload } from "@/lib/manager-payload";
import { managerTarget } from "@/lib/manager-target";
import {
  dispatchManagerRequest,
  type ManagerTransportOptions,
} from "@/lib/manager-transport";
import { auth } from "@/auth";
import {
  isAllowedOperation,
  isTrustedMutationOrigin,
} from "@/lib/manager-proxy-policy";

export const dynamic = "force-dynamic";
const noStore = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json",
};
function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: noStore });
}
async function forward(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (!isHostedMode()) return error(404, "Not found");
  const owner = process.env.MANAGER_OWNER_ID;
  if (!isLoginConfigured()) return error(503, "Sign-in is not configured.");
  const session = await auth();
  if (!owner || !session?.user?.id || session.user.id !== owner)
    return error(401, "Sign in required.");
  if (
    request.method === "POST" &&
    !isTrustedMutationOrigin(
      request.headers.get("origin"),
      process.env.AUTH_URL,
    )
  )
    return error(403, "Request origin is not allowed.");
  const { path } = await context.params;
  if (path.length !== 1 || !isAllowedOperation(request.method, path[0]))
    return error(404, "Not found");
  if (request.url.length > 64000) return error(413, "Request too large.");
  const token = process.env.MANAGER_SERVICE_TOKEN;
  let binding: ManagerTransportOptions["binding"];
  try {
    const context = getCloudflareContext();
    binding = (
      context.env as unknown as { MANAGER?: ManagerTransportOptions["binding"] }
    ).MANAGER;
  } catch {
    // The normal Next.js development server has no Cloudflare binding.
  }
  if (
    !binding &&
    (process.env.NODE_ENV === "production" || !process.env.MANAGER_INTERNAL_URL)
  )
    return error(503, "Manager connection is not configured.");
  const rawUrl = binding
    ? "https://manager.internal/trpc/"
    : process.env.MANAGER_INTERNAL_URL;
  if (!token || token.length < 32)
    return error(503, "Manager connection is not configured.");
  const target = managerTarget(
    rawUrl,
    path[0],
    new URL(request.url).search,
    process.env.NODE_ENV !== "production",
  );
  if (!target) return error(503, "Manager connection is not configured.");
  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    const length = request.headers.get("content-length");
    if (!length || !/^\d+$/.test(length) || Number(length) > 1024 * 1024)
      return error(413, "Request too large.");
    body = await request.arrayBuffer();
    if (body.byteLength > 1024 * 1024) return error(413, "Request too large.");
  }
  try {
    const response = await dispatchManagerRequest({
      binding,
      target,
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        "x-manager-actor": owner,
        "content-type": "application/json",
        "trpc-accept": "application/json",
      },
      body,
      allowNetworkFallback: process.env.NODE_ENV !== "production",
    });
    const payload: unknown = await response.json();
    return Response.json(sanitizeManagerPayload(payload), {
      status: response.status,
      headers: noStore,
    });
  } catch {
    return error(503, "Manager is unavailable. Try again.");
  }
}
export const GET = forward;
export const POST = forward;
