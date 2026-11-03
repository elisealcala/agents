import path from "node:path";

type ConfigurationState = "configured" | "unconfigured";
export type RuntimeCapabilities = {
  evidence: ConfigurationState;
  model: ConfigurationState;
  intake: ConfigurationState;
  conversation: ConfigurationState;
};

/** Configuration status only. It does not claim the provider is reachable. */
export function resolveRuntimeConfig(env: NodeJS.ProcessEnv): {
  libraryRoot: string | null;
  classifierUrl: string | null;
  model: string | null;
  capabilities: RuntimeCapabilities;
} {
  const root = env.PROJECT_MANAGER_LIBRARY_ROOT?.trim();
  const libraryRoot =
    root && !root.includes("\0") && path.isAbsolute(root) ? root : null;
  const rawUrl =
    env.PROJECT_MANAGER_CLASSIFIER_URL?.trim() || "http://127.0.0.1:8789";
  let classifierUrl: string | null = null;
  try {
    const url = new URL(rawUrl);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    )
      classifierUrl = url.toString();
  } catch {
    // Invalid configuration remains unavailable without exposing its value.
  }
  const model =
    env.PROJECT_MANAGER_MODEL?.trim() || env.INGEST_MODEL?.trim() || null;
  const evidence = libraryRoot && classifierUrl ? "configured" : "unconfigured";
  const modelState =
    model && model !== "unconfigured" && env.ANTHROPIC_API_KEY?.trim()
      ? "configured"
      : "unconfigured";
  const dependent =
    evidence === "configured" && modelState === "configured"
      ? "configured"
      : "unconfigured";
  return {
    libraryRoot,
    classifierUrl,
    model,
    capabilities: {
      evidence,
      model: modelState,
      intake: dependent,
      conversation: dependent,
    },
  };
}
