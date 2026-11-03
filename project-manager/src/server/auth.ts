import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export type HostedConfig = { token: string; ownerId: string; bindHost: string };

/** Hosted mode must never start with incomplete service authentication. */
export function parseHostedConfig(env: NodeJS.ProcessEnv): HostedConfig | null {
  if (env.NODE_ENV === "production" && env.MANAGER_HOSTED !== "true")
    throw new Error(
      "Hosted manager mode must be explicitly configured in production.",
    );
  if (env.MANAGER_HOSTED === undefined || env.MANAGER_HOSTED === "false")
    return null;
  if (env.MANAGER_HOSTED !== "true")
    throw new Error("Invalid hosted manager mode.");
  const token = env.MANAGER_SERVICE_TOKEN ?? "";
  const ownerId = env.MANAGER_OWNER_ID ?? "";
  const bindHost = env.MANAGER_BIND_HOST ?? "127.0.0.1";
  if (
    token.length < 32 ||
    !/^[\x21-\x7e]+$/.test(token) ||
    !/^[1-9][0-9]*$/.test(ownerId) ||
    !["127.0.0.1", "0.0.0.0"].includes(bindHost)
  ) {
    throw new Error("Hosted manager service authentication is not configured.");
  }
  return { token, ownerId, bindHost };
}

export function verifyServiceRequest(
  headers: IncomingHttpHeaders,
  config: HostedConfig,
): boolean {
  const authorization = headers.authorization;
  const actor = headers["x-manager-actor"];
  if (
    headers.origin !== undefined ||
    typeof authorization !== "string" ||
    typeof actor !== "string" ||
    actor !== config.ownerId
  )
    return false;
  const provided = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${config.token}`);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

/** Reject ambiguous duplicate security headers before Node's normalization. */
export function hasDuplicateSecurityHeaders(
  headers: NodeJS.Dict<string[]>,
): boolean {
  return ["authorization", "x-manager-actor", "origin"].some(
    (name) => (headers[name]?.length ?? 0) > 1,
  );
}
