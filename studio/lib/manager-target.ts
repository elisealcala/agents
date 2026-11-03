/** Resolve only a fixed, configured manager endpoint; callers cannot select a host. */
export function managerTarget(
  rawUrl: string | undefined,
  operation: string,
  search: string,
  allowInsecureLoopback = false,
): URL | null {
  if (
    !rawUrl ||
    !/^[a-zA-Z]+(?:\.[a-zA-Z]+)+(?:,[a-zA-Z]+(?:\.[a-zA-Z]+)+)*$/.test(
      operation,
    ) ||
    (search !== "" && (!search.startsWith("?") || search.includes("#")))
  )
    return null;
  try {
    const base = new URL(rawUrl);
    if (
      !(
        base.protocol === "https:" ||
        (allowInsecureLoopback &&
          base.protocol === "http:" &&
          (base.hostname === "localhost" || base.hostname === "127.0.0.1"))
      ) ||
      base.username ||
      base.password ||
      !["/", "/trpc/"].includes(base.pathname) ||
      base.search ||
      base.hash
    )
      return null;
    return new URL(`${operation}${search}`, base);
  } catch {
    return null;
  }
}
