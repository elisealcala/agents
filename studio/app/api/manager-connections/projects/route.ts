import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "../../../../auth.ts";
import { isHostedMode } from "../../../../lib/manager-mode.ts";
import {
  PROJECTS_COOKIE_PATH,
  PROJECTS_STATE_COOKIE,
  REQUIRED_PROJECTS_SCOPES,
  completeProjectsCallback,
  createProjectsState,
  manageProjectsConnection,
  outcomeResponse,
  type ProjectsAction,
} from "../../../../lib/manager-projects-auth.ts";
import { readCookie } from "../../../../lib/manager-github-app.ts";

export const dynamic = "force-dynamic";

type Binding = Parameters<typeof manageProjectsConnection>[0]["binding"];

async function context(): Promise<{
  actor: string;
  owner: string;
  token: string;
  secret: string;
  binding?: Binding;
} | null> {
  if (!isHostedMode()) return null;
  const owner = process.env.MANAGER_OWNER_ID ?? "";
  const token = process.env.MANAGER_SERVICE_TOKEN ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!owner || token.length < 32 || secret.length < 32) return null;
  const session = await auth();
  const actor = session?.user?.id;
  if (!actor || actor !== owner) return null;
  let binding: Binding;
  try {
    binding = (getCloudflareContext().env as { MANAGER?: Binding }).MANAGER;
  } catch {
    binding = undefined;
  }
  return { actor, owner, token, secret, binding };
}

/** Start authorization (no code) or complete the callback (code + state). */
export async function GET(request: Request): Promise<Response> {
  const ctx = await context();
  if (!ctx) return outcomeResponse("invalid-state", false);
  const search = new URL(request.url).searchParams;
  if (search.has("code") || search.has("state")) {
    const outcome = await completeProjectsCallback({
      ...ctx,
      search,
      cookieNonce: readCookie(
        request.headers.get("cookie"),
        PROJECTS_STATE_COOKIE,
      ),
    });
    return outcomeResponse(outcome);
  }
  const clientId = process.env.MANAGER_PROJECTS_CLIENT_ID ?? "";
  if (!/^[A-Za-z0-9._-]{8,64}$/.test(clientId))
    return outcomeResponse("unavailable", false);
  const { state, nonce } = await createProjectsState(ctx.secret, ctx.owner);
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", clientId);
  target.searchParams.set("scope", REQUIRED_PROJECTS_SCOPES.join(" "));
  target.searchParams.set("state", state);
  const headers = new Headers({
    location: target.toString(),
    "cache-control": "private, no-store",
  });
  headers.append(
    "set-cookie",
    `${PROJECTS_STATE_COOKIE}=${nonce}; Path=${PROJECTS_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  return new Response(null, { status: 302, headers });
}

/** Refresh, rotate or disconnect the Projects connection only. */
export async function POST(request: Request): Promise<Response> {
  const ctx = await context();
  if (!ctx) return outcomeResponse("invalid-state", false);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    return outcomeResponse("rejected", false);
  const action = new URL(request.url).searchParams.get("action");
  if (action !== "refresh" && action !== "rotate" && action !== "disconnect")
    return outcomeResponse("rejected", false);
  const outcome = await manageProjectsConnection(
    ctx,
    action as ProjectsAction,
  );
  return outcomeResponse(outcome, false);
}
