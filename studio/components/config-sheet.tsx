"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc";

export function ConfigSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const config = useQuery(trpc.config.get.queryOptions());
  const corrections = useQuery(trpc.corrections.list.queryOptions());
  const update = useMutation(trpc.config.update.mutationOptions());
  const record = useMutation(trpc.corrections.record.mutationOptions());
  const remove = useMutation(trpc.corrections.delete.mutationOptions());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Classifier settings</SheetTitle>
          <SheetDescription>
            Saved on this library. The next ingest uses them.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-8rem)] px-4">
          {config.data ? (
            <SettingsForm
              key={JSON.stringify(config.data)}
              initial={config.data}
              saving={update.isPending}
              onSave={async (input) => {
                try {
                  await update.mutateAsync(input);
                  await queryClient.invalidateQueries();
                  toast.success("Settings saved");
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Save failed",
                  );
                }
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Loading settings…</p>
          )}
          <div className="mt-6 space-y-3 pb-6">
            <h3 className="text-sm font-medium">Few-shot corrections</h3>
            <CorrectionForm
              onCreate={async (input) => {
                const result = await record.mutateAsync(input);
                if (result.status === "error") {
                  toast.error(result.error.message);
                  return;
                }
                await queryClient.invalidateQueries();
              }}
            />
            <ul className="space-y-2">
              {(corrections.data ?? []).map((correction) => (
                <li
                  key={correction.id}
                  className="rounded-md border p-2 text-xs"
                >
                  <p>
                    {correction.wrongCategory} → {correction.correctCategory}
                  </p>
                  <p className="text-muted-foreground">
                    {correction.originalPath}
                  </p>
                  {correction.note ? <p>{correction.note}</p> : null}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void remove
                        .mutateAsync({ id: correction.id })
                        .then(() => queryClient.invalidateQueries())
                    }
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function SettingsForm({
  initial,
  saving,
  onSave,
}: {
  initial: {
    fitThreshold: number;
    dedupThreshold: number;
    exampleLimit: number;
    promptTemplate: string;
    defaults: {
      fitThreshold: number;
      dedupThreshold: number;
      exampleLimit: number;
      promptTemplate: string;
    };
  };
  saving: boolean;
  onSave: (input: {
    fitThreshold: number;
    dedupThreshold: number;
    exampleLimit: number;
    promptTemplate: string;
  }) => Promise<void>;
}) {
  const [fitThreshold, setFitThreshold] = useState(initial.fitThreshold);
  const [dedupThreshold, setDedupThreshold] = useState(initial.dedupThreshold);
  const [exampleLimit, setExampleLimit] = useState(initial.exampleLimit);
  const [promptTemplate, setPromptTemplate] = useState(initial.promptTemplate);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          fitThreshold,
          dedupThreshold,
          exampleLimit,
          promptTemplate,
        });
      }}
    >
      <div className="block space-y-2 text-sm">
        <span>Fit threshold {fitThreshold.toFixed(2)}</span>
        <Slider
          min={0.01}
          max={1}
          step={0.01}
          value={[fitThreshold]}
          onValueChange={(value) => setFitThreshold(value[0] ?? fitThreshold)}
        />
      </div>
      <div className="block space-y-2 text-sm">
        <span>Dedup threshold {dedupThreshold.toFixed(2)}</span>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[dedupThreshold]}
          onValueChange={(value) =>
            setDedupThreshold(value[0] ?? dedupThreshold)
          }
        />
      </div>
      <div className="block space-y-1 text-sm">
        <label htmlFor="example-limit">Example limit</label>
        <Input
          id="example-limit"
          type="number"
          min={0}
          value={exampleLimit}
          onChange={(event) => setExampleLimit(Number(event.target.value))}
        />
      </div>
      <div className="block space-y-1 text-sm">
        <label htmlFor="system-prompt">System prompt</label>
        <Textarea
          id="system-prompt"
          className="min-h-48 font-mono text-xs"
          value={promptTemplate}
          onChange={(event) => setPromptTemplate(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setFitThreshold(initial.defaults.fitThreshold);
            setDedupThreshold(initial.defaults.dedupThreshold);
            setExampleLimit(initial.defaults.exampleLimit);
            setPromptTemplate(initial.defaults.promptTemplate);
            void onSave(initial.defaults);
          }}
        >
          Reset
        </Button>
      </div>
    </form>
  );
}

function CorrectionForm({
  onCreate,
}: {
  onCreate: (input: {
    originalPath: string;
    wrongCategory: string;
    correctCategory: string;
    note?: string;
  }) => Promise<void>;
}) {
  const [originalPath, setOriginalPath] = useState("");
  const [wrongCategory, setWrongCategory] = useState("");
  const [correctCategory, setCorrectCategory] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate({
          originalPath,
          wrongCategory,
          correctCategory,
          note: note || undefined,
        }).then(() => {
          setOriginalPath("");
          setWrongCategory("");
          setCorrectCategory("");
          setNote("");
        });
      }}
    >
      <Input
        placeholder="Original path"
        value={originalPath}
        onChange={(event) => setOriginalPath(event.target.value)}
        required
      />
      <Input
        placeholder="Wrong category"
        value={wrongCategory}
        onChange={(event) => setWrongCategory(event.target.value)}
        required
      />
      <Input
        placeholder="Correct category"
        value={correctCategory}
        onChange={(event) => setCorrectCategory(event.target.value)}
        required
      />
      <Input
        placeholder="Note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button type="submit" size="sm" variant="secondary">
        Add correction
      </Button>
    </form>
  );
}
