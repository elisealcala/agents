/**
 * Model configuration read from the environment (DEC-025).
 *
 * Nothing here reaches the network. Anthropic is the only provider, and both
 * the model id and the API key must be set explicitly.
 */

/** The only supported provider. */
export const PROVIDERS = ["anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** A resolved model id and credential. */
export type ModelConfig = {
  provider: Provider;
  model: string;
  apiKey: string;
};

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ModelConfig {
  const model = env.INGEST_MODEL?.trim();
  const apiKey = env.ANTHROPIC_API_KEY?.trim();

  if (!model) {
    throw new Error("INGEST_MODEL is required");
  }
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  return { provider: "anthropic", model, apiKey };
}
