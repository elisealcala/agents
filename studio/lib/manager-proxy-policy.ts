const queries = new Set([
  "agent.identity",
  "agent.configuration",
  "delivery.repositories",
  "delivery.work",
  "delivery.outbox",
  "projects.list",
  "projects.get",
  "reviews.list",
  "runs.list",
  "runs.get",
  "evidence.read",
  "evaluations.list",
  "evaluations.get",
]);
const mutations = new Set([
  "delivery.bindKnownRepository",
  "projects.create",
  "notes.submit",
  "notes.retry",
  "reviews.resolve",
  "conversations.send",
]);

/** Do not allow callers to choose arbitrary manager procedures or mix methods. */
export function isAllowedOperation(method: string, path: string): boolean {
  const names = path.split(",");
  const allow =
    method === "GET" ? queries : method === "POST" ? mutations : null;
  return (
    !!allow &&
    names.length > 0 &&
    names.length <= 20 &&
    names.every((name) => allow.has(name))
  );
}

export function isTrustedMutationOrigin(
  origin: string | null,
  authUrl: string | undefined,
): boolean {
  if (!origin || !authUrl) return false;
  try {
    const configured = new URL(authUrl);
    return (
      (configured.protocol === "https:" ||
        (configured.protocol === "http:" &&
          (configured.hostname === "localhost" ||
            configured.hostname === "127.0.0.1"))) &&
      origin === configured.origin
    );
  } catch {
    return false;
  }
}
