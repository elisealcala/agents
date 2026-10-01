import { readFile } from "node:fs/promises";
import path from "node:path";

/** One agent process the studio knows how to call. */
export type RegisteredAgent = {
  id: string;
  name: string;
  url: string;
};

/** Prefer a local override, then the checked-in example. */
export async function loadAgents(): Promise<RegisteredAgent[]> {
  const localPath = path.join(process.cwd(), "agents.local.json");
  const examplePath = path.join(process.cwd(), "agents.example.json");
  const raw = await readFile(localPath, "utf8").catch(() =>
    readFile(examplePath, "utf8"),
  );
  const parsed = JSON.parse(raw) as { agents?: unknown };
  if (!Array.isArray(parsed.agents)) return [];
  return parsed.agents.filter(isAgent);
}

function isAgent(value: unknown): value is RegisteredAgent {
  if (!value || typeof value !== "object") return false;
  const agent = value as Record<string, unknown>;
  return (
    typeof agent.id === "string" &&
    agent.id.length > 0 &&
    typeof agent.name === "string" &&
    typeof agent.url === "string" &&
    agent.url.startsWith("http")
  );
}
