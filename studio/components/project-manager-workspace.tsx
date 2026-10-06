"use client";

import {
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ApprovedPanel,
  ConversationPanel,
  EvaluationsPanel,
  EvidencePanel,
  NotesPanel,
  ReviewPanel,
} from "@/components/project-manager-panels";
import { TraceView } from "@/components/trace-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type EvidenceRecord,
  makeProjectClient,
  ProjectTRPCProvider,
  useProjectTRPC,
} from "@/lib/project-trpc";
import { makeQueryClient } from "@/lib/trpc";

export function ProjectManagerWorkspace({
  name,
  url,
}: {
  name: string;
  url: string;
}) {
  const queryClient = useMemo(() => makeQueryClient(), []);
  const trpcClient = useMemo(() => makeProjectClient(url), [url]);
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectTRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ManagerView name={name} />
      </ProjectTRPCProvider>
    </QueryClientProvider>
  );
}

function ManagerView({ name }: { name: string }) {
  const trpc = useProjectTRPC();
  const identity = useQuery(trpc.agent.identity.queryOptions());
  const projects = useQuery(trpc.projects.list.queryOptions());
  const create = useMutation(trpc.projects.create.mutationOptions());
  const [projectId, setProjectId] = useState("");
  const [newName, setNewName] = useState("");
  const [requestedRun, setRequestedRun] = useState<{
    projectId: string;
    runId: string;
  } | null>(null);
  const selectedId =
    projects.data?.find((project) => project.id === projectId)?.id ??
    projects.data?.[0]?.id;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h1 className="text-base font-medium">{name}</h1>
          <p className="text-xs text-muted-foreground">
            Notes become proposed changes. Approved facts ground every answer.
          </p>
        </div>
        <Badge variant={identity.isError ? "destructive" : "outline"}>
          {identity.isError
            ? "offline"
            : identity.isSuccess
              ? "reachable"
              : "checking"}
        </Badge>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          Project
          <select
            aria-label="Project"
            className="h-9 min-w-40 rounded-md border bg-background px-2"
            value={selectedId ?? ""}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {!selectedId ? <option value="">Choose a project</option> : null}
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim()) return;
            void create
              .mutateAsync({ name: newName.trim() })
              .then(async (project) => {
                await projects.refetch();
                setProjectId(project.id);
                setNewName("");
              })
              .catch(showError);
          }}
        >
          <Input
            aria-label="New project name"
            placeholder="New project name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button disabled={!newName.trim() || create.isPending}>
            Create project
          </Button>
        </form>
        <Button
          variant="ghost"
          onClick={() => void projects.refetch()}
          disabled={projects.isFetching}
        >
          Refresh projects
        </Button>
      </div>
      {projects.isError ? (
        <p className="p-4 text-sm text-destructive">{projects.error.message}</p>
      ) : selectedId ? (
        <ProjectView
          key={`${selectedId}:${requestedRun?.runId ?? ""}`}
          projectId={selectedId}
          initialRunId={
            requestedRun?.projectId === selectedId
              ? requestedRun.runId
              : undefined
          }
          onEvaluationRun={(projectId, runId) => {
            setProjectId(projectId);
            setRequestedRun({ projectId, runId });
          }}
        />
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          {projects.isPending
            ? "Loading projects…"
            : "Create a project to submit your first note."}
        </p>
      )}
    </main>
  );
}

function ProjectView({
  projectId,
  initialRunId,
  onEvaluationRun,
}: {
  projectId: string;
  initialRunId?: string;
  onEvaluationRun: (projectId: string, runId: string) => void;
}) {
  const trpc = useProjectTRPC();
  const project = useQuery({
    ...trpc.projects.get.queryOptions({ projectId }),
    refetchInterval: 1500,
  });
  const runs = useQuery({
    ...trpc.runs.list.queryOptions({ projectId }),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "running") ? 500 : 3000,
  });
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
  const [spanId, setSpanId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRecord | null>(null);
  const [inspector, setInspector] = useState("trace");
  const run = useQuery({
    ...trpc.runs.get.queryOptions({ projectId, runId: runId ?? "" }),
    enabled: runId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 400 : false,
  });

  function selectRun(id: string) {
    setRunId(id);
    setSpanId(null);
    setInspector("trace");
  }

  function selectEvidence(value: EvidenceRecord) {
    setEvidence(value);
    setInspector("source");
  }

  if (project.isError) {
    return (
      <p className="p-4 text-sm text-destructive">{project.error.message}</p>
    );
  }
  if (!project.data) {
    return <p className="p-4 text-sm">Loading project…</p>;
  }
  const pending = project.data.candidates.filter(
    (candidate) => candidate.status === "pending",
  ).length;

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel defaultSize={65} minSize={35}>
        <Tabs defaultValue="notes" className="h-full min-h-0 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="review">Review ({pending})</TabsTrigger>
              <TabsTrigger value="approved">Approved facts</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="runs">Runs</TabsTrigger>
              <TabsTrigger value="evaluations">Accuracy</TabsTrigger>
            </TabsList>
            <span className="text-xs text-muted-foreground">
              Revision {project.data.revision}
            </span>
          </div>
          <TabsContent value="notes" className="min-h-0 overflow-y-auto">
            <NotesPanel project={project.data} onRun={selectRun} />
          </TabsContent>
          <TabsContent value="review" className="min-h-0 overflow-y-auto">
            <ReviewPanel project={project.data} onEvidence={selectEvidence} />
          </TabsContent>
          <TabsContent value="approved" className="min-h-0 overflow-y-auto">
            <ApprovedPanel project={project.data} onEvidence={selectEvidence} />
          </TabsContent>
          <TabsContent value="chat" className="min-h-0 overflow-y-auto">
            <ConversationPanel
              project={project.data}
              onRun={selectRun}
              onEvidence={selectEvidence}
            />
          </TabsContent>
          <TabsContent value="runs" className="min-h-0 overflow-y-auto">
            <ul className="space-y-2">
              {(runs.data ?? []).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`flex w-full justify-between gap-2 rounded-md border p-3 text-left text-sm ${
                      item.id === runId ? "bg-muted" : "hover:bg-muted"
                    }`}
                    onClick={() => selectRun(item.id)}
                  >
                    <span>
                      {item.action === "intake" ? "Collect note" : "Answer"}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {item.startedAt}
                      </span>
                    </span>
                    <Badge
                      variant={
                        item.status === "error" ? "destructive" : "outline"
                      }
                    >
                      {item.status}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
            {runs.isError ? (
              <p className="text-sm text-destructive">{runs.error.message}</p>
            ) : null}
            {runs.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : null}
          </TabsContent>
          <TabsContent value="evaluations" className="min-h-0 overflow-y-auto">
            <EvaluationsPanel onRun={onEvaluationRun} />
          </TabsContent>
        </Tabs>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={35} minSize={25}>
        <Tabs
          value={inspector}
          onValueChange={setInspector}
          className="h-full min-h-0 gap-0"
        >
          <TabsList className="m-3">
            <TabsTrigger value="trace">Execution trace</TabsTrigger>
            <TabsTrigger value="source">Source passage</TabsTrigger>
          </TabsList>
          <TabsContent value="trace" className="min-h-0">
            {run.isError ? (
              <p className="p-3 text-sm text-destructive">
                {run.error.message}
              </p>
            ) : null}
            {run.data?.error ? (
              <p className="p-3 text-sm text-destructive">{run.data.error}</p>
            ) : null}
            <TraceView
              spans={run.data?.spans ?? []}
              selectedId={spanId}
              onSelect={setSpanId}
            />
          </TabsContent>
          <TabsContent value="source" className="min-h-0">
            <ScrollArea className="h-full">
              <EvidencePanel
                key={evidence?.documentRef ?? "empty"}
                projectId={projectId}
                evidence={evidence}
              />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Request failed");
}
