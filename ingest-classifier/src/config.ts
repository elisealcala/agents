export const PROVIDERS = ["openai", "anthropic", "xai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type ModelConfig = {
  provider: Provider;
  model: string;
  apiKey: string;
};

const KEY_BY_PROVIDER: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
};

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ModelConfig {
  const providerRaw = env.INGEST_PROVIDER?.trim();
  const model = env.INGEST_MODEL?.trim();

  if (!providerRaw) {
    throw new Error("INGEST_PROVIDER is required (openai | anthropic | xai)");
  }
  if (!isProvider(providerRaw)) {
    throw new Error(
      `Unknown INGEST_PROVIDER "${providerRaw}". Use openai | anthropic | xai`,
    );
  }
  if (!model) {
    throw new Error("INGEST_MODEL is required");
  }

  const keyName = KEY_BY_PROVIDER[providerRaw];
  const apiKey = env[keyName]?.trim();
  if (!apiKey) {
    throw new Error(
      `${keyName} is required when INGEST_PROVIDER=${providerRaw}`,
    );
  }

  return { provider: providerRaw, model, apiKey };
}

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
