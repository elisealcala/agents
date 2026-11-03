import { isHostedMode } from "@/lib/manager-mode";
import { ManagerShell } from "@/components/manager/shell";
import { loadAgents } from "@/lib/registry";

export const dynamic = "force-dynamic";

export default async function ManagerPage() {
  if (isHostedMode()) return <ManagerShell url="/api/manager" />;
  const agents = await loadAgents();
  const manager = agents.find((agent) => agent.kind === "project-manager");
  return <ManagerShell url={manager?.url ?? null} />;
}
