"use client";

import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc";

export function MemoryPanel() {
  const trpc = useTRPC();
  const categories = useQuery(trpc.memory.categories.queryOptions());
  const documents = useQuery(trpc.memory.documents.queryOptions());
  const audit = useQuery(trpc.memory.audit.queryOptions());
  const corrections = useQuery(trpc.corrections.list.queryOptions());

  return (
    <Tabs defaultValue="categories">
      <TabsList>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
        <TabsTrigger value="corrections">Corrections</TabsTrigger>
      </TabsList>
      <TabsContent value="categories">
        <ScrollArea className="h-[28rem]">
          <ul className="space-y-2 p-1">
            {(categories.data ?? []).map((category) => (
              <li key={category.id} className="rounded-md border p-2 text-sm">
                <p className="font-mono text-xs">{category.id}</p>
                <p>{category.name}</p>
                <p className="text-muted-foreground">{category.definition}</p>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="documents">
        <ScrollArea className="h-[28rem]">
          <ul className="space-y-2 p-1">
            {(documents.data ?? []).map((document) => (
              <li key={document.id} className="rounded-md border p-2 text-sm">
                <p className="font-mono text-xs">{document.destinationPath}</p>
                <p>{document.summary}</p>
                <p className="text-muted-foreground">
                  {document.categoryId} · {document.embeddingStatus}
                </p>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="audit">
        <ScrollArea className="h-[28rem]">
          <ul className="space-y-2 p-1">
            {(audit.data ?? []).map((row) => (
              <li key={row.id} className="rounded-md border p-2 text-sm">
                <p className="font-mono text-xs">{row.sourcePath}</p>
                <p>
                  {row.status}
                  {row.category ? ` · ${row.category}` : ""}
                </p>
                {row.error ? (
                  <p className="text-destructive">{row.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="corrections">
        <ul className="space-y-2 p-1">
          {(corrections.data ?? []).map((correction) => (
            <li key={correction.id} className="rounded-md border p-2 text-sm">
              <p>
                {correction.wrongCategory} → {correction.correctCategory}
              </p>
              <p className="text-muted-foreground">{correction.originalPath}</p>
              {correction.note ? <p>{correction.note}</p> : null}
            </li>
          ))}
        </ul>
      </TabsContent>
    </Tabs>
  );
}
