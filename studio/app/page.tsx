import { isHostedMode } from "@/lib/manager-mode";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadAgents } from "@/lib/registry";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (isHostedMode()) redirect("/manager");
  const agents = await loadAgents();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-medium">Studio</h1>
        <p className="text-sm text-muted-foreground">
          Local agents on this machine. Each one runs its own server.
        </p>
      </div>
      <Link
        href="/manager"
        className="rounded-lg border px-4 py-3 font-medium hover:bg-muted"
      >
        Open project manager
      </Link>
      <ul className="divide-y rounded-lg border">
        {agents.map((agent) => (
          <li key={agent.id}>
            <Link
              href={`/agents/${agent.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-muted"
            >
              <span>{agent.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {agent.url}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
