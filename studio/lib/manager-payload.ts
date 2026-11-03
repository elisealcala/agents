const generic = "The manager could not complete this request.";

/** Existing local state may contain raw provider errors. Never forward those to hosted clients. */
export function sanitizeManagerPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeManagerPayload);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (key === "stack") continue;
    if (key === "error" && item !== null && item !== undefined) {
      if (typeof item === "object" && !Array.isArray(item)) {
        const wrapper = item as Record<string, unknown>;
        const wrapped =
          wrapper.json &&
          typeof wrapper.json === "object" &&
          !Array.isArray(wrapper.json);
        const source = wrapped
          ? (wrapper.json as Record<string, unknown>)
          : wrapper;
        const sourceData =
          source.data && typeof source.data === "object"
            ? (source.data as Record<string, unknown>)
            : {};
        const safe = {
          message: generic,
          code: source.code,
          data: {
            code: sourceData.code,
            httpStatus: sourceData.httpStatus,
            path: sourceData.path,
          },
        };
        result.error = wrapped ? { json: safe } : safe;
      } else result.error = generic;
    } else result[key] = sanitizeManagerPayload(item);
  }
  return result;
}
