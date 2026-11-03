/** Cloudflare binding calls stay private; network fallback is for local development only. */
type ManagerBinding = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};
export type ManagerTransportOptions = {
  binding?: ManagerBinding;
  target: URL;
  method: string;
  headers: HeadersInit;
  body?: ArrayBuffer;
  allowNetworkFallback: boolean;
  fetchImpl?: typeof fetch;
};

export async function dispatchManagerRequest(
  options: ManagerTransportOptions,
): Promise<Response> {
  const { binding, target, method, headers, body } = options;
  if (binding) {
    const privateTarget = new URL(
      target.pathname.startsWith("/trpc/")
        ? target.pathname
        : `/trpc${target.pathname}`,
      "https://manager.internal",
    );
    privateTarget.search = target.search;
    const response = await binding.get(binding.idFromName("primary")).fetch(
      new Request(privateTarget, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      }),
    );
    if (response.status >= 300 && response.status < 400)
      throw new Error("Manager redirect refused.");
    return response;
  }
  if (!options.allowNetworkFallback)
    throw new Error("Private manager binding is unavailable.");
  const response = await (options.fetchImpl ?? fetch)(target, {
    method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error("Manager redirect refused.");
  return response;
}
