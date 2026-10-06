import Link from "next/link";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { ProjectManagerWorkspace } from "@/components/project-manager-workspace";
import { loadAgents } from "@/lib/registry";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agents = await loadAgents();
  const agent = agents.find((item) => item.id === id);
  if (!agent) notFound();

  return (
    <div className="flex h-dvh">
      <aside className="flex w-56 shrink-0 flex-col border-r">
        <Link href="/" className="border-b px-4 py-3 text-sm font-medium">
          Studio
        </Link>
        <nav className="flex flex-col p-2">
          {agents.map((item) => (
            <Link
              key={item.id}
              href={`/agents/${item.id}`}
              className={`rounded-md px-2 py-1.5 text-sm hover:bg-muted ${
                item.id === id ? "bg-muted" : ""
              }`}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      </aside>
      {agent.kind === "project-manager" ? (
        <ProjectManagerWorkspace
          key={agent.id}
          name={agent.name}
          url={agent.url}
        />
      ) : (
        <Workspace key={agent.id} name={agent.name} url={agent.url} />
      )}
    </div>
  );
}
