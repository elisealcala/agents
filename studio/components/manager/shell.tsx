"use client";

import {
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ProjectManagerWorkspace } from "@/components/project-manager-workspace";
import {
  makeProjectClient,
  ProjectTRPCProvider,
  useProjectTRPC,
} from "@/lib/project-trpc";
import { makeQueryClient } from "@/lib/trpc";

const sections = [
  "Overview",
  "Projects",
  "Conversation & evidence",
  "Work",
  "Inbox",
  "Activity",
] as const;
type Section = (typeof sections)[number];

export function ManagerShell({ url }: { url: string | null }) {
  const queryClient = useMemo(() => makeQueryClient(), []);
  const client = useMemo(() => (url ? makeProjectClient(url) : null), [url]);
  if (!url || !client)
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Project manager</h1>
        <p className="mt-3">
          Manager connection is not configured. Add the project manager to the
          Studio registry and refresh.
        </p>
        <Link className="underline" href="/">
          Return to Studio
        </Link>
      </main>
    );
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectTRPCProvider trpcClient={client} queryClient={queryClient}>
        <ManagerHome url={url} />
      </ProjectTRPCProvider>
    </QueryClientProvider>
  );
}

function ManagerHome({ url }: { url: string }) {
  const trpc = useProjectTRPC();
  const repositories = useQuery(trpc.delivery.repositories.queryOptions());
  const projects = useQuery(trpc.projects.list.queryOptions());
  const bind = useMutation(trpc.delivery.bindKnownRepository.mutationOptions());
  const [section, setSection] = useState<Section>("Overview");
  const [scope, setScope] = useState("portfolio");
  useEffect(() => {
    const saved = window.localStorage.getItem("manager-scope");
    if (saved) setScope(saved);
  }, []);
  const previewScopes: Record<string, string> = {
    "preview:agents": "agents (not connected)",
    "preview:chore-design": "chore-design (not connected)",
  };
  const selected = repositories.data?.find(
    (repo) => repo.identity.repositoryId === scope,
  );
  const work = useQuery(
    trpc.delivery.work.queryOptions(
      { repositoryId: selected?.identity.repositoryId ?? "" },
      { enabled: !!selected },
    ),
  );
  const outbox = useQuery(
    trpc.delivery.outbox.queryOptions(
      { repositoryId: selected?.identity.repositoryId ?? "" },
      { enabled: !!selected },
    ),
  );
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b px-5 py-4">
        <Link href="/" className="text-sm underline">
          Studio
        </Link>
        <h1 className="text-2xl font-semibold">Project manager</h1>
        <p className="text-sm text-muted-foreground">
          Local foundation · GitHub connection, QA and automation are not yet
          available.
        </p>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-5">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Scope{" "}
          <select
            className="rounded border bg-background p-2"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              window.localStorage.setItem("manager-scope", event.target.value);
            }}
          >
            <option value="portfolio">Portfolio</option>
            {scope !== "portfolio" && !previewScopes[scope] && !selected && (
              <option value={scope}>Saved repository (unavailable)</option>
            )}
            {!repositories.data?.some(
              (repo) => repo.identity.repositoryId === "1355217430",
            ) && <option value="preview:agents">agents (not bound)</option>}
            {!repositories.data?.some(
              (repo) => repo.identity.repositoryId === "1437904422",
            ) && (
              <option value="preview:chore-design">
                chore-design (not bound)
              </option>
            )}
            {repositories.data?.map((repo) => (
              <option
                key={repo.identity.repositoryId}
                value={repo.identity.repositoryId}
              >
                {repo.identity.owner}/{repo.identity.name}
              </option>
            ))}
          </select>
        </label>
        <nav
          aria-label="Manager sections"
          className="my-5 flex flex-wrap gap-2"
        >
          {sections.map((item) => (
            <button
              key={item}
              type="button"
              aria-current={section === item ? "page" : undefined}
              onClick={() => setSection(item)}
              className={`rounded border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${section === item ? "bg-foreground text-background" : "hover:bg-muted"}`}
            >
              {item}
            </button>
          ))}
        </nav>
        {(repositories.isError || projects.isError) && (
          <p role="alert" className="mb-4 rounded border p-3">
            Manager is unavailable. Last checked{" "}
            {new Date(
              Math.max(repositories.errorUpdatedAt, projects.errorUpdatedAt),
            ).toLocaleString()}
            . Check that the local manager is running, then{" "}
            <button
              className="underline"
              type="button"
              onClick={() => {
                void repositories.refetch();
                void projects.refetch();
              }}
            >
              retry
            </button>
            .
          </p>
        )}
        {section === "Conversation & evidence" ? (
          <div>
            <p className="mb-3 text-sm text-muted-foreground">
              Notes projects are independent of the repository scope above.
              Choose a notes project in the workspace below.
            </p>
            <div className="flex h-[75vh] min-h-[40rem] overflow-auto rounded border">
              <ProjectManagerWorkspace
                name="Notes, reviews and conversation"
                url={url}
              />
            </div>
          </div>
        ) : (
          <main className="rounded-lg border p-5">
            <h2 className="text-xl font-semibold">{section}</h2>
            {section === "Overview" && (
              <div className="mt-3 space-y-3">
                <p>
                  {selected
                    ? `${selected.identity.owner}/${selected.identity.name}`
                    : (previewScopes[scope] ??
                      (scope === "portfolio"
                        ? "Portfolio"
                        : "Saved repository unavailable"))}
                </p>
                <p>
                  Repository connections and live GitHub status are not
                  configured yet. QA and automated delivery are disabled.
                </p>
                <p>
                  {repositories.isPending
                    ? "Checking saved repositories…"
                    : repositories.isError
                      ? "Saved repositories unavailable"
                      : `${repositories.data?.length ?? 0} saved repositories`}
                  ;{" "}
                  {projects.isPending
                    ? "checking notes projects…"
                    : projects.isError
                      ? "notes projects unavailable"
                      : `${projects.data?.length ?? 0} notes projects`}
                  .
                </p>
              </div>
            )}
            {section === "Projects" && (
              <div className="mt-3 space-y-3">
                <h3 className="font-medium">Repositories</h3>
                <p>
                  Save a local reference for each repository. This does not
                  connect GitHub or import its work.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["agents", "chore-design"] as const).map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                      disabled={
                        bind.isPending ||
                        repositories.isError ||
                        repositories.data?.some(
                          (repo) =>
                            repo.identity.owner === "elisealcala" &&
                            repo.identity.name === name,
                        )
                      }
                      onClick={() => {
                        void bind
                          .mutateAsync({ name })
                          .then(async (repo) => {
                            await repositories.refetch();
                            setScope(repo.identity.repositoryId);
                            window.localStorage.setItem(
                              "manager-scope",
                              repo.identity.repositoryId,
                            );
                          })
                          .catch(() => {});
                      }}
                    >
                      Save {name} reference
                    </button>
                  ))}
                </div>
                {bind.isError && (
                  <p role="alert">
                    Could not save the reference: {bind.error.message}
                  </p>
                )}

                {repositories.isError ? (
                  <p>Repository state is unavailable.</p>
                ) : repositories.data?.length ? (
                  <ul className="list-inside list-disc">
                    {repositories.data.map((repo) => (
                      <li key={repo.identity.repositoryId}>
                        {repo.identity.owner}/{repo.identity.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No repositories connected. GitHub connection will be
                    available in a later stage.
                  </p>
                )}
                <h3 className="font-medium">Notes projects</h3>
                {projects.isError ? (
                  <p>Notes projects are unavailable.</p>
                ) : projects.data?.length ? (
                  <ul className="list-inside list-disc">
                    {projects.data.map((project) => (
                      <li key={project.id}>{project.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No saved notes projects.</p>
                )}
                <p>
                  Open Conversation &amp; evidence to review notes and their
                  sources.
                </p>
              </div>
            )}
            {section === "Work" && (
              <div className="mt-3">
                {selected ? (
                  work.isPending ? (
                    "Loading saved work…"
                  ) : work.isError ? (
                    "Saved work is unavailable."
                  ) : work.data?.length ? (
                    <ul className="list-inside list-disc">
                      {work.data.map((item) => (
                        <li key={item.identity.issueNumber}>
                          Issue #{item.identity.issueNumber}: {item.status}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "No work has been observed for this repository."
                  )
                ) : (
                  "GitHub work inventory is not connected yet. No work status is shown until it is observed."
                )}
              </div>
            )}
            {section === "Inbox" && (
              <p className="mt-3">
                No notifications are available. The durable inbox will be
                enabled in a later stage.
              </p>
            )}
            {section === "Activity" && (
              <div className="mt-3">
                {selected ? (
                  outbox.isPending ? (
                    "Loading local activity…"
                  ) : outbox.isError ? (
                    "Activity is unavailable. Try again after reconnecting."
                  ) : outbox.data?.length ? (
                    <ul className="list-inside list-disc">
                      {outbox.data.map((item) => (
                        <li key={item.id}>
                          {item.kind}: {item.status}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "No local delivery activity."
                  )
                ) : (
                  "Select a saved repository to inspect local delivery activity."
                )}
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
