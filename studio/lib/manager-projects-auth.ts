import { dispatchManagerRequest } from "./manager-transport.ts";

/**
 * Owner-only personal Projects authorization, separate from App installation and
 * sign-in. Codes and tokens go only to the private service, never to a URL, page
 * or response body.
 */
export const PROJECTS_STATE_COOKIE = "manager_gh_projects_state";
export const PROJECTS_COOKIE_PATH = "/api/manager-connections/projects";
export const REQUIRED_PROJECTS_SCOPES = ["project"] as const;
const STATE_TTL_MS = 10 * 60 * 1000;
const PURPOSE = "projects";
const encoder = new TextEncoder();

export type ProjectsOutcome =
  | "connected"
  | "disconnected"
  | "invalid-state"
  | "rejected"
  | "missing-scope"
  | "unavailable";

export type ProjectsAction = "refresh" | "rotate" | "disconnect";

const messages: Record<ProjectsOutcome, [number, string]> = {
  connected: [200, "Projects access connected. You can return to setup."],
  disconnected: [200, "Projects access disconnected."],
  "invalid-state": [
    400,
    "This authorization link is missing, expired, already used or not yours. Start again.",
  ],
  rejected: [403, "Projects authorization could not be verified. Start again."],
  "missing-scope": [
    403,
    "Projects access is missing a required permission. Authorize again and grant project access.",
  ],
  unavailable: [503, "Projects connection is unavailable. Try again later."],
};

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createProjectsState(
  secret: string,
  owner: string,
  now = Date.now(),
): Promise<{ state: string; nonce: string }> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const payload = `${PURPOSE}.${owner}.${now + STATE_TTL_MS}.${nonce}`;
  return { state: `${payload}.${await sign(secret, payload)}`, nonce };
}

/** Nonces already consumed by this process; the service also enforces one use. */
const consumed = new Map<string, number>();

export function resetConsumedProjectsNonces(): void {
  consumed.clear();
}

export async function verifyProjectsState(
  secret: string,
  owner: string,
  state: string | null,
  cookieNonce: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!state || !cookieNonce) return false;
  const parts = state.split(".");
  if (parts.length !== 5) return false;
  const [purpose, stateOwner, expires, nonce, mac] = parts;
  return (
    purpose === PURPOSE &&
    equal(
      mac,
      await sign(secret, `${purpose}.${stateOwner}.${expires}.${nonce}`),
    ) &&
    stateOwner === owner &&
    /^[0-9]+$/.test(expires) &&
    Number(expires) >= now &&
    equal(nonce, cookieNonce)
  );
}

export function outcomeResponse(
  outcome: ProjectsOutcome,
  clearCookie = true,
): Response {
  const [status, message] = messages[outcome];
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
  });
  if (clearCookie)
    headers.append(
      "set-cookie",
      `${PROJECTS_STATE_COOKIE}=; Path=${PROJECTS_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Projects access</title></head><body><main><h1>Projects access</h1><p>${message}</p></main></body></html>`,
    { status, headers },
  );
}

type Binding = Parameters<typeof dispatchManagerRequest>[0]["binding"];

export type ProjectsInput = {
  token: string;
  actor: string;
  owner: string;
  binding?: Binding;
};

async function callService(
  input: ProjectsInput,
  path: string,
  method: string,
  body: unknown,
): Promise<ProjectsOutcome> {
  try {
    const response = await dispatchManagerRequest({
      binding: input.binding,
      target: new URL(`https://manager.internal/connections/projects${path}`),
      method,
      headers: {
        authorization: `Bearer ${input.token}`,
        "x-manager-actor": input.actor,
        "content-type": "application/json",
      },
      body: encoder.encode(JSON.stringify(body)).buffer as ArrayBuffer,
      allowNetworkFallback: false,
    });
    if (
      response.status === 400 ||
      response.status === 403 ||
      response.status === 404
    )
      return "rejected";
    if (!response.ok) return "unavailable";
    const result = (await response.json()) as {
      connected?: unknown;
      scopes?: unknown;
    } | null;
    if (!result) return "unavailable";
    if (result.connected === false) return "disconnected";
    if (result.connected !== true) return "unavailable";
    const scopes = Array.isArray(result.scopes)
      ? result.scopes.filter((s): s is string => typeof s === "string")
      : [];
    return REQUIRED_PROJECTS_SCOPES.every((s) => scopes.includes(s))
      ? "connected"
      : "missing-scope";
  } catch {
    return "unavailable";
  }
}

export type ProjectsCallbackInput = ProjectsInput & {
  secret: string;
  search: URLSearchParams;
  cookieNonce: string | null;
  now?: number;
};

/** Validate state/owner once, then let the private service exchange and store the code. */
export async function completeProjectsCallback(
  input: ProjectsCallbackInput,
): Promise<ProjectsOutcome> {
  const now = input.now ?? Date.now();
  for (const [nonce, expires] of consumed)
    if (expires < now) consumed.delete(nonce);
  if (
    !input.owner ||
    input.actor !== input.owner ||
    !(await verifyProjectsState(
      input.secret,
      input.owner,
      input.search.get("state"),
      input.cookieNonce,
      now,
    )) ||
    !input.cookieNonce ||
    consumed.has(input.cookieNonce)
  )
    return "invalid-state";
  consumed.set(input.cookieNonce, now + STATE_TTL_MS);
  const code = input.search.get("code") ?? "";
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(code)) return "rejected";
  return callService(input, "", "POST", { code });
}

/** Refresh, rotate or disconnect only the Projects connection. */
export async function manageProjectsConnection(
  input: ProjectsInput,
  action: ProjectsAction,
): Promise<ProjectsOutcome> {
  if (!input.owner || input.actor !== input.owner) return "invalid-state";
  return callService(
    input,
    `/${action}`,
    action === "disconnect" ? "DELETE" : "POST",
    {},
  );
}
