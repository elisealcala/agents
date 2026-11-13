import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "../../../../auth.ts";
import {
  STATE_COOKIE,
  completeInstallCallback,
  createInstallState,
  outcomeResponse,
  readCookie,
} from "../../../../lib/manager-github-app.ts";
import {
  isHostedMode,
  isLoginConfigured,
} from "../../../../lib/manager-mode.ts";

export const dynamic = "force-dynamic";

function json(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}

/** `?action=start` begins installation; otherwise this is GitHub's setup callback. */
export async function GET(request: Request): Promise<Response> {
  if (!isHostedMode()) return json(404, "Not found.");
  const token = process.env.MANAGER_SERVICE_TOKEN ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!isLoginConfigured() || token.length < 32)
    return json(503, "GitHub connection unavailable.");
  const owner = process.env.MANAGER_OWNER_ID ?? "";
  let actor: string | undefined;
  try {
    actor = (await auth())?.user?.id;
  } catch {
    return json(503, "GitHub connection unavailable.");
  }
  if (!actor || actor !== owner) return json(401, "Authentication required.");

  const url = new URL(request.url);
  if (url.searchParams.get("action") === "start") {
    const slug = process.env.GITHUB_APP_SLUG ?? "";
    if (!/^[A-Za-z0-9-]+$/.test(slug))
      return json(503, "GitHub connection unavailable.");
    const { state, nonce } = await createInstallState(secret, owner);
    const target = new URL(`https://github.com/apps/${slug}/installations/new`);
    target.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: {
        location: target.toString(),
        "cache-control": "private, no-store",
        "set-cookie": `${STATE_COOKIE}=${nonce}; Path=/api/manager-connections/github-app; HttpOnly; SameSite=Lax; Max-Age=600${
          url.protocol === "https:" ? "; Secure" : ""
        }`,
      },
    });
  }

  let binding: Parameters<typeof completeInstallCallback>[0]["binding"];
  try {
    binding = (
      getCloudflareContext() as unknown as {
        env: { MANAGER?: typeof binding };
      }
    ).env.MANAGER;
  } catch {
    binding = undefined;
  }
  if (!binding) return outcomeResponse("unavailable", false);
  const outcome = await completeInstallCallback({
    secret,
    token,
    owner,
    actor,
    search: url.searchParams,
    cookieNonce: readCookie(request.headers.get("cookie"), STATE_COOKIE),
    binding,
  });
  return outcomeResponse(outcome);
}
