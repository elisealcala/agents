/** Production is always protected; malformed flags never enable local mode. */
export function isHostedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === "production" ||
    (env.MANAGER_HOSTED !== undefined && env.MANAGER_HOSTED !== "false")
  );
}

/** Validate the canonical login origin without exposing configuration values. */
export function isLoginConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    !/^[1-9][0-9]*$/.test(env.MANAGER_OWNER_ID ?? "") ||
    (env.AUTH_SECRET?.length ?? 0) < 32 ||
    !env.AUTH_GITHUB_ID?.trim() ||
    !env.AUTH_GITHUB_SECRET?.trim() ||
    !env.AUTH_URL
  )
    return false;
  try {
    const url = new URL(env.AUTH_URL);
    const local =
      env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (
      (url.protocol === "https:" || local) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
