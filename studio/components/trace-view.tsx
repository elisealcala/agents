"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export type TraceSpan = {
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error: string | null;
  startedAt?: string;
};

export function TraceView({
  spans,
  selectedId,
  onSelect,
}: {
  spans: TraceSpan[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = spans.find((span) => span.id === selectedId) ?? null;
  return (
    <div className="grid h-full min-h-0 grid-rows-2">
      <ScrollArea className="min-h-0 border-b">
        <div className="p-3">
          {spans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Run the agent to see stages, model turns, and tool calls.
            </p>
          ) : (
            <TraceTree
              spans={spans}
              parentId={null}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )}
        </div>
      </ScrollArea>
      <ScrollArea className="min-h-0">
        <div className="p-3">
          {selected ? <SpanDetail span={selected} /> : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function TraceTree({
  spans,
  parentId,
  selectedId,
  onSelect,
}: {
  spans: TraceSpan[];
  parentId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const children = spans.filter((span) => span.parentId === parentId);
  if (children.length === 0) return null;
  return (
    <ul className="space-y-1">
      {children.map((span) => (
        <li key={span.id}>
          <button
            type="button"
            onClick={() => onSelect(span.id)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted ${
              selectedId === span.id ? "bg-muted" : ""
            }`}
          >
            <span className="font-mono">{span.name}</span>
            <Badge variant={badgeFor(span.status)}>{span.status}</Badge>
          </button>
          <div className="ml-3 border-l pl-2">
            <TraceTree
              spans={spans}
              parentId={span.id}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SpanDetail({ span }: { span: TraceSpan }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-sm">{span.name}</h3>
        <Badge variant="outline">{span.kind}</Badge>
      </div>
      {span.error ? (
        <p className="text-sm text-destructive">{span.error}</p>
      ) : null}
      <Payload title="Input" value={span.input} />
      <Payload title="Output" value={span.output} />
    </div>
  );
}

function Payload({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-medium text-muted-foreground">
        {title}
      </h4>
      <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function badgeFor(
  status: string,
): "default" | "destructive" | "outline" | "secondary" {
  if (status === "failed" || status === "error") return "destructive";
  if (status === "ok" || status === "success") return "default";
  if (status === "partial") return "secondary";
  return "outline";
}
