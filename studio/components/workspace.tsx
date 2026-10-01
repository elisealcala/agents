"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { ConfigSheet } from "@/components/config-sheet";
import { MemoryPanel } from "@/components/memory-panel";
import { TraceView, type TraceSpan } from "@/components/trace-view";
import { makeClient, makeQueryClient, TRPCProvider, useTRPC } from "@/lib/trpc";
import { QueryClientProvider } from "@tanstack/react-query";

export function Workspace({ name, url }: { name: string; url: string }) {
  const queryClient = useMemo(() => makeQueryClient(), []);
  const trpcClient = useMemo(() => makeClient(url), [url]);
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <WorkspaceView name={name} />
      </TRPCProvider>
    </QueryClientProvider>
  );
}

function WorkspaceView({ name }: { name: string }) {
  const trpc = useTRPC();
  const identity = useQuery(trpc.agent.identity.queryOptions());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [liveSpans, setLiveSpans] = useState<TraceSpan[]>([]);
  const run = useQuery({
    ...trpc.runs.get.queryOptions({ runId: selectedRunId ?? "" }),
    enabled: selectedRunId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 400 : false,
  });

  const spans = mergeSpans(run.data?.spans ?? [], liveSpans);
  const liveAnswer = answerFromSpans(spans);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h1 className="text-base font-medium">{name}</h1>
          <p className="font-mono text-xs text-muted-foreground">
            {identity.data?.root ?? "Library unavailable"}
            {identity.data?.model ? ` · ${identity.data.model.model}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={identity.isError ? "destructive" : "outline"}>
            {identity.isError
              ? "offline"
              : identity.isSuccess
                ? "reachable"
                : "checking"}
          </Badge>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
        </div>
      </header>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={55} minSize={35}>
          <Tabs defaultValue="ask" className="h-full p-4">
            <TabsList>
              <TabsTrigger value="ask">Ask</TabsTrigger>
              <TabsTrigger value="runs">Runs</TabsTrigger>
              <TabsTrigger value="memory">Memory</TabsTrigger>
            </TabsList>
            <TabsContent value="ask" className="min-h-0">
              <AskPanel
                run={run.data}
                liveAnswer={liveAnswer}
                onRun={(runId) => {
                  setLiveSpans([]);
                  setSelectedSpanId(null);
                  setSelectedRunId(runId);
                }}
              />
            </TabsContent>
            <TabsContent value="runs">
              <RunsPanel
                selectedRunId={selectedRunId}
                onRun={(runId) => {
                  setLiveSpans([]);
                  setSelectedSpanId(null);
                  setSelectedRunId(runId);
                }}
              />
            </TabsContent>
            <TabsContent value="memory">
              <MemoryPanel />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={45} minSize={25}>
          <div className="h-full min-h-0">
            {selectedRunId ? (
              <LiveSpans
                key={selectedRunId}
                runId={selectedRunId}
                onSpan={(span) =>
                  setLiveSpans((current) => mergeSpans(current, [span]))
                }
              />
            ) : null}
            <TraceView
              spans={spans}
              selectedId={selectedSpanId}
              onSelect={setSelectedSpanId}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <ConfigSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function LiveSpans({
  runId,
  onSpan,
}: {
  runId: string;
  onSpan: (span: TraceSpan) => void;
}) {
  const trpc = useTRPC();
  useSubscription(
    trpc.runs.follow.subscriptionOptions(
      { runId },
      {
        onData: (span) => onSpan(span),
      },
    ),
  );
  return null;
}

function AskPanel({
  run,
  liveAnswer,
  onRun,
}: {
  run:
    | {
        id: string;
        action: string;
        status: string;
        input?: unknown;
        output?: unknown;
      }
    | undefined;
  liveAnswer: string | null;
  onRun: (runId: string) => void;
}) {
  const trpc = useTRPC();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      role: "user" | "assistant";
      text: string;
      runId?: string;
    }>
  >([]);
  const start = useMutation(trpc.runs.start.mutationOptions());

  const storedAnswer =
    run?.action === "ask_question" && run.status !== "running"
      ? readAnswer(run.output)
      : null;
  const answer = storedAnswer ?? liveAnswer;
  const visible = thread(messages, run, answer);

  return (
    <div className="flex h-[32rem] flex-col gap-3">
      <ScrollArea className="flex-1 rounded-md border">
        <div className="space-y-3 p-3">
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ask the library a question. The answer cites stored notes.
            </p>
          ) : (
            visible.map((message) => (
              <p key={message.id} className="whitespace-pre-wrap text-sm">
                <span className="font-medium">
                  {message.role === "user" ? "You" : "Classifier"}:{" "}
                </span>
                {message.text}
              </p>
            ))
          )}
        </div>
      </ScrollArea>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = question.trim();
          if (!text) return;
          const id = crypto.randomUUID();
          setMessages((current) => [...current, { id, role: "user", text }]);
          setQuestion("");
          void start
            .mutateAsync({ action: "ask_question", input: { question: text } })
            .then((started) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === id
                    ? { ...message, runId: started.runId }
                    : message,
                ),
              );
              onRun(started.runId);
            })
            .catch((error: unknown) => {
              toast.error(
                error instanceof Error ? error.message : "Ask failed",
              );
            });
        }}
      >
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What were the Q3 cache takeaways?"
          className="min-h-16"
        />
        <Button type="submit" disabled={start.isPending}>
          Ask
        </Button>
      </form>
    </div>
  );
}

function RunsPanel({
  selectedRunId,
  onRun,
}: {
  selectedRunId: string | null;
  onRun: (runId: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const runs = useQuery(trpc.runs.list.queryOptions());
  const start = useMutation(trpc.runs.start.mutationOptions());
  const [search, setSearch] = useState("");

  async function begin(
    input: Parameters<typeof start.mutateAsync>[0],
  ): Promise<void> {
    try {
      const started = await start.mutateAsync(input);
      await queryClient.invalidateQueries();
      onRun(started.runId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Run failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void begin({ action: "ingest_inbox", input: {} })}
        >
          Ingest inbox
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void begin({ action: "suggest_category_splits", input: {} })
          }
        >
          Suggest splits
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void begin({ action: "backfill_embeddings", input: {} })
          }
        >
          Backfill
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!search.trim()) return;
          void begin({
            action: "search_documents",
            input: { question: search.trim() },
          });
        }}
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search stored notes"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <ul className="space-y-1">
        {(runs.data ?? []).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onRun(item.id)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-muted ${
                selectedRunId === item.id ? "bg-muted" : ""
              }`}
            >
              <span className="font-mono">{item.action}</span>
              <Badge variant="outline">{item.status}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function mergeSpans(base: TraceSpan[], extra: TraceSpan[]): TraceSpan[] {
  const byId = new Map<string, TraceSpan>();
  for (const span of base) byId.set(span.id, span);
  for (const span of extra) byId.set(span.id, span);
  return [...byId.values()].sort((left, right) =>
    (left.startedAt ?? left.id).localeCompare(right.startedAt ?? right.id),
  );
}

function thread(
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    runId?: string;
  }>,
  run:
    | { id: string; action: string; input?: unknown; status: string }
    | undefined,
  answer: string | null,
) {
  if (run?.action !== "ask_question") return messages;
  const question = readQuestion(run.input);
  const earlier = messages.filter((message) => message.runId !== run.id);
  const localUser =
    messages.find(
      (message) => message.role === "user" && message.runId === run.id,
    ) ??
    earlier.find(
      (message) => message.role === "user" && message.text === question,
    );
  const turn: typeof messages = [];
  if (localUser) turn.push({ ...localUser, runId: run.id });
  else if (question) {
    turn.push({
      id: `${run.id}-question`,
      role: "user",
      text: question,
      runId: run.id,
    });
  }
  if (answer) {
    turn.push({
      id: `${run.id}-answer`,
      role: "assistant",
      text: answer,
      runId: run.id,
    });
  }
  return [
    ...earlier.filter((message) => message.id !== localUser?.id),
    ...turn,
  ];
}

function readQuestion(input: unknown): string | null {
  if (!input || typeof input !== "object" || !("question" in input)) {
    return null;
  }
  const question = (input as { question?: unknown }).question;
  return typeof question === "string" ? question : null;
}

function readAnswer(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const record = output as { answer?: unknown; data?: unknown };
  if (typeof record.answer === "string") return record.answer;
  if (record.data && typeof record.data === "object") {
    const nested = record.data as { answer?: unknown };
    if (typeof nested.answer === "string") return nested.answer;
  }
  return null;
}

function answerFromSpans(spans: TraceSpan[]): string | null {
  const action = [...spans]
    .reverse()
    .find(
      (span) =>
        span.name === "ask_question" &&
        span.parentId === null &&
        span.status !== "running",
    );
  return action ? readAnswer(action.output) : null;
}
