import { config as loadEnvFile } from "dotenv";
import { createModelClient } from "./providers/createClient.ts";

loadEnvFile();

const SMOKE_PROMPT = "Reply with the provider and model id.";

async function main(): Promise<void> {
  const client = createModelClient();
  const text = await client.complete(SMOKE_PROMPT);
  console.log(
    JSON.stringify(
      { provider: client.provider, model: client.model, text },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
