import { dispatchManagerRequest } from "./manager-transport.ts";

/** Owner-only GitHub App installation flow; no secret ever reaches a URL or page. */
export const STATE_COOKIE = "manager_gh_app_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

export type SetupOutcome =
  | "connected"
  | "invalid-state"
  | "rejected"
  | "unavailable";

const messages: Record<SetupOutcome, [number, string]> = {
  connected: [200, "GitHub App connected. You can return to setup."],
  "invalid-state": [
    400,
    "This setup link is missing, expired or not yours. Start the installation again.",
  ],
  rejected: [
    403,
    "GitHub installation could not be verified. Start the installation again.",
  ],
  unavailable: [503, "GitHub connection is unavailable. Try again later."],
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

/** Create a signed, owner-bound, expiring state plus the nonce for the browser cookie. */
export async function createInstallState(
  secret: string,
  owner: string,
  now = Date.now(),
): Promise<{ state: string; nonce: string }> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const payload = `${owner}.${now + STATE_TTL_MS}.${nonce}`;
  return { state: `${payload}.${await sign(secret, payload)}`, nonce };
}

/** Returns true only for an unexpired, untampered state for this owner and browser. */
export async function verifyInstallState(
  secret: string,
  owner: string,
  state: string | null,
  cookieNonce: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!state || !cookieNonce) return false;
  const parts = state.split(".");
  if (parts.length !== 4) return false;
  const [stateOwner, expires, nonce, mac] = parts;
  if (
    !equal(mac, await sign(secret, `${stateOwner}.${expires}.${nonce}`)) ||
    stateOwner !== owner ||
    !/^[0-9]+$/.test(expires) ||
    Number(expires) < now ||
    !equal(nonce, cookieNonce)
  )
    return false;
  return true;
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export function outcomeResponse(
  outcome: SetupOutcome,
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
      `${STATE_COOKIE}=; Path=/api/manager-connections/github-app; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GitHub App setup</title></head><body><main><h1>GitHub App setup</h1><p>${message}</p></main></body></html>`,
    { status, headers },
  );
}

export type CallbackInput = {
  secret: string;
  token: string;
  owner: string;
  actor: string;
  search: URLSearchParams;
  cookieNonce: string | null;
  binding?: Parameters<typeof dispatchManagerRequest>[0]["binding"];
  now?: number;
};

/** Validate state and owner, then let the private service verify and save the installation. */
export async function completeInstallCallback(
  input: CallbackInput,
): Promise<SetupOutcome> {
  if (
    !input.owner ||
    input.actor !== input.owner ||
    !(await verifyInstallState(
      input.secret,
      input.owner,
      input.search.get("state"),
      input.cookieNonce,
      input.now,
    ))
  )
    return "invalid-state";
  const installationId = input.search.get("installation_id") ?? "";
  if (!/^[1-9][0-9]{0,18}$/.test(installationId)) return "rejected";
  try {
    const response = await dispatchManagerRequest({
      binding: input.binding,
      target: new URL("https://manager.internal/connections/github-app"),
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "x-manager-actor": input.actor,
        "content-type": "application/json",
      },
      body: encoder.encode(JSON.stringify({ installationId }))
        .buffer as ArrayBuffer,
      allowNetworkFallback: false,
    });
    if (
      response.status === 400 ||
      response.status === 403 ||
      response.status === 404
    )
      return "rejected";
    if (!response.ok) return "unavailable";
    const result: unknown = await response.json();
    return result && (result as { connected?: unknown }).connected === true
      ? "connected"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
