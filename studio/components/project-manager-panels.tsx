"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type CandidateRecord,
  type EvaluationRecord,
  type EvidenceRecord,
  type ProjectRecord,
  useProjectTRPC,
} from "@/lib/project-trpc";

export function NotesPanel({
  project,
  onRun,
}: {
  project: ProjectRecord;
  onRun: (id: string) => void;
}) {
  const trpc = useProjectTRPC();
  const queryClient = useQueryClient();
  const submit = useMutation(trpc.notes.submit.mutationOptions());
  const retry = useMutation(trpc.notes.retry.mutationOptions());
  const [markdown, setMarkdown] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceVersion, setSourceVersion] = useState("1");
  const [sourceDate, setSourceDate] = useState("");
  // Keep the generated identity through an ambiguous network failure.
  const submissionId = useRef<string | null>(null);

  return (
    <div className="space-y-5">
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!markdown.trim()) return;
          submissionId.current ??= crypto.randomUUID();
          void submit
            .mutateAsync({
              projectId: project.id,
              sourceId: sourceId.trim() || submissionId.current,
              sourceVersion: sourceVersion.trim(),
              markdown,
              ...(sourceDate ? { sourceDate } : {}),
            })
            .then(async (run) => {
              onRun(run.id);
              setMarkdown("");
              setSourceId("");
              setSourceVersion("1");
              setSourceDate("");
              submissionId.current = null;
              await queryClient.invalidateQueries();
            })
            .catch(showError);
        }}
      >
        <p className="text-sm text-muted-foreground">
          Submit Markdown for {project.name}. Facts will wait for your review.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label
            className="space-y-1 text-xs"
            htmlFor={`${project.id}-source-name`}
          >
            <span>Source name (optional)</span>
            <Input
              id={`${project.id}-source-name`}
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              placeholder="weekly-update"
              disabled={submit.isPending}
            />
          </label>
          <label
            className="space-y-1 text-xs"
            htmlFor={`${project.id}-source-version`}
          >
            <span>Source version</span>
            <Input
              id={`${project.id}-source-version`}
              value={sourceVersion}
              onChange={(event) => setSourceVersion(event.target.value)}
              disabled={submit.isPending}
              required
            />
          </label>
          <label
            className="space-y-1 text-xs"
            htmlFor={`${project.id}-source-date`}
          >
            <span>Note date (optional)</span>
            <Input
              id={`${project.id}-source-date`}
              type="date"
              value={sourceDate}
              onChange={(event) => setSourceDate(event.target.value)}
              disabled={submit.isPending}
            />
          </label>
        </div>
        <Textarea
          aria-label="Markdown note"
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          placeholder="Paste your project update here…"
          className="min-h-40 font-mono"
          disabled={submit.isPending}
        />
        <Button disabled={!markdown.trim() || submit.isPending}>
          {submit.isPending ? "Submitting…" : "Collect note"}
        </Button>
      </form>
      <ul className="space-y-3">
        {project.notes.map((note) => (
          <li key={note.id} className="space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {note.sourceId} · version {note.sourceVersion}
              </span>
              <Badge
                variant={note.status === "error" ? "destructive" : "outline"}
              >
                {note.status === "review" ? "Ready for review" : note.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Storage: {note.documentRef ? "confirmed" : "not confirmed"}
              {" · "}Search index: {note.indexStatus ?? "pending"}
              {note.sourceDate ? ` · Note date: ${note.sourceDate}` : ""}
            </p>
            {note.indexStatus === "missing" ? (
              <p className="text-xs text-muted-foreground">
                This source is stored, but search coverage is incomplete. Retry
                to repair its index.
              </p>
            ) : null}
            {note.error ? (
              <p className="text-sm text-destructive">{note.error}</p>
            ) : null}
            <details>
              <summary className="cursor-pointer text-xs">
                Submitted note
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs">
                {note.markdown}
              </pre>
            </details>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRun(note.runId)}
              >
                View run
              </Button>
              {note.status === "error" || note.indexStatus === "missing" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={retry.isPending || note.status === "storing"}
                  onClick={() => {
                    void retry
                      .mutateAsync({ projectId: project.id, noteId: note.id })
                      .then(async (run) => {
                        onRun(run.id);
                        await queryClient.invalidateQueries();
                      })
                      .catch(showError);
                  }}
                >
                  Retry same note
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReviewPanel({
  project,
  onEvidence,
}: {
  project: ProjectRecord;
  onEvidence: (evidence: EvidenceRecord) => void;
}) {
  const trpc = useProjectTRPC();
  const candidates = useQuery({
    ...trpc.reviews.list.queryOptions({ projectId: project.id }),
    refetchInterval: 1500,
  });
  const pending = (candidates.data ?? project.candidates).filter(
    (candidate) => candidate.status === "pending",
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Review each proposed value against its source. Editing creates your own
        confirmation and retains the original proposal.
      </p>
      {candidates.isError ? (
        <p className="text-sm text-destructive">{candidates.error.message}</p>
      ) : null}
      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No changes awaiting review.
        </p>
      ) : (
        pending.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            project={project}
            candidate={candidate}
            onEvidence={onEvidence}
          />
        ))
      )}
    </div>
  );
}

function CandidateCard({
  project,
  candidate,
  onEvidence,
}: {
  project: ProjectRecord;
  candidate: CandidateRecord;
  onEvidence: (evidence: EvidenceRecord) => void;
}) {
  const trpc = useProjectTRPC();
  const queryClient = useQueryClient();
  const resolve = useMutation(trpc.reviews.resolve.mutationOptions());
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(candidate.value);
  const [effectiveDate, setEffectiveDate] = useState(
    candidate.effectiveDate ?? "",
  );
  const previous = project.approved.find(
    (fact) =>
      fact.entity === candidate.entity && fact.field === candidate.field,
  );

  function decide(action: "accept" | "edit" | "reject") {
    void resolve
      .mutateAsync({
        projectId: project.id,
        candidateId: candidate.id,
        action,
        expectedRevision: project.revision,
        ...(action === "edit"
          ? { value: value.trim(), effectiveDate: effectiveDate || null }
          : {}),
      })
      .then(async (updated) => {
        queryClient.setQueryData(
          trpc.projects.get.queryKey({ projectId: project.id }),
          updated,
        );
        await queryClient.invalidateQueries();
      })
      .catch(async (error: unknown) => {
        showError(error);
        await queryClient.invalidateQueries();
      });
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">
          {candidate.entity} · {label(candidate.field)}
        </h3>
        {candidate.conflict ? (
          <Badge variant="secondary">Conflict</Badge>
        ) : null}
        {candidate.historical ? (
          <Badge variant="outline">Historical evidence</Badge>
        ) : null}
      </div>
      {previous ? (
        <p className="text-xs text-muted-foreground">
          Last approved: {previous.value}
          {previous.effectiveDate ? ` (${previous.effectiveDate})` : ""}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap text-sm">Proposed: {candidate.value}</p>
      <p className="text-xs text-muted-foreground">
        Effective date: {candidate.effectiveDate ?? "Unknown"}
      </p>
      {candidate.conflict ? (
        <p className="text-xs text-muted-foreground">
          This field remains disputed until review resolves it. The last
          approved value is historical context.
        </p>
      ) : null}
      {candidate.historical ? (
        <p className="text-xs text-muted-foreground">
          Accepting older evidence retains history without reverting newer
          state.
        </p>
      ) : null}
      <EvidenceQuote evidence={candidate.evidence} onEvidence={onEvidence} />
      {editing ? (
        <form
          className="space-y-2 rounded-md bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) decide("edit");
          }}
        >
          <label
            className="block space-y-1 text-xs"
            htmlFor={`${candidate.id}-correction`}
          >
            <span>Your confirmed value</span>
            <Textarea
              id={`${candidate.id}-correction`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
            />
          </label>
          <label
            className="block space-y-1 text-xs"
            htmlFor={`${candidate.id}-correction-date`}
          >
            <span>Effective date (optional)</span>
            <Input
              id={`${candidate.id}-correction-date`}
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={!value.trim() || resolve.isPending}>
              Confirm correction
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={resolve.isPending}
            onClick={() => decide("accept")}
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={resolve.isPending}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={resolve.isPending}
            onClick={() => decide("reject")}
          >
            Reject
          </Button>
        </div>
      )}
    </section>
  );
}

export function ApprovedPanel({
  project,
  onEvidence,
}: {
  project: ProjectRecord;
  onEvidence: (evidence: EvidenceRecord) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Revision {project.revision}. Values below have been reviewed.
      </p>
      {project.approved.length === 0 ? (
        <p className="text-sm text-muted-foreground">No approved facts yet.</p>
      ) : null}
      {project.approved.map((fact) => {
        const disputed = project.candidates.some(
          (candidate) =>
            candidate.status === "pending" &&
            candidate.conflict &&
            candidate.entity === fact.entity &&
            candidate.field === fact.field,
        );
        return (
          <section key={fact.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">
                {fact.entity} · {label(fact.field)}
              </h3>
              {disputed ? <Badge variant="secondary">Disputed</Badge> : null}
            </div>
            <p className="whitespace-pre-wrap text-sm">{fact.value}</p>
            <p className="text-xs text-muted-foreground">
              {disputed ? "Last approved; historical context" : "Approved"}
              {" · "}Effective date: {fact.effectiveDate ?? "Unknown"}
              {" · "}Revision {fact.revision}
            </p>
            <EvidenceQuote evidence={fact.evidence} onEvidence={onEvidence} />
          </section>
        );
      })}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Approved history ({project.history.length})
        </summary>
        <ul className="mt-3 space-y-3">
          {project.history.map((fact) => (
            <li key={fact.id} className="space-y-1 text-sm">
              <p>
                {fact.entity} · {label(fact.field)}: {fact.value}
              </p>
              <p className="text-xs text-muted-foreground">
                Revision {fact.revision} · {fact.effectiveDate ?? "Undated"}
              </p>
              <EvidenceQuote evidence={fact.evidence} onEvidence={onEvidence} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function ConversationPanel({
  project,
  onRun,
  onEvidence,
}: {
  project: ProjectRecord;
  onRun: (id: string) => void;
  onEvidence: (evidence: EvidenceRecord) => void;
}) {
  const trpc = useProjectTRPC();
  const queryClient = useQueryClient();
  const send = useMutation(trpc.conversations.send.mutationOptions());
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState("");
  const conversation =
    conversationId === "new"
      ? undefined
      : (project.conversations.find((item) => item.id === conversationId) ??
        project.conversations.at(-1));
  const pending = project.candidates.filter(
    (candidate) => candidate.status === "pending",
  ).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Answers use approved facts. {pending} proposed changes await review.
      </p>
      <label className="flex items-center gap-2 text-xs">
        Conversation
        <select
          className="h-9 min-w-40 rounded-md border bg-background px-2"
          value={conversation?.id ?? "new"}
          onChange={(event) => setConversationId(event.target.value)}
        >
          <option value="new">New conversation</option>
          {project.conversations.map((item, index) => (
            <option key={item.id} value={item.id}>
              Conversation {index + 1}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-4">
        {(conversation?.messages ?? []).map((message) => (
          <article key={message.id} className="space-y-3 rounded-lg border p-4">
            <p className="whitespace-pre-wrap text-sm font-medium">
              You: {message.question}
            </p>
            {message.answer ? (
              <>
                <Badge variant="outline">{message.answer.status}</Badge>
                <p className="whitespace-pre-wrap text-sm">
                  {message.answer.text}
                </p>
                {message.answer.pendingReview > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {message.answer.pendingReview} pending changes may affect
                    this answer. They were not treated as approved facts.
                  </p>
                ) : null}
                {message.answer.missingEmbeddings > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Search coverage was incomplete for{" "}
                    {message.answer.missingEmbeddings} sources.
                  </p>
                ) : null}
                {message.answer.claims.map((claim) => (
                  <div key={claim.factId} className="space-y-1 border-l pl-3">
                    <p className="text-xs">
                      {claim.entity} · {label(claim.field)}: {claim.value}
                    </p>
                    <EvidenceQuote
                      evidence={claim.evidence}
                      onEvidence={onEvidence}
                    />
                  </div>
                ))}
                {message.answer.questions.length > 0 ? (
                  <div className="text-sm">
                    <p className="font-medium">Clarification needed</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {[...new Set(message.answer.questions)].map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {message.answer.suggestions.length > 0 ? (
                  <div className="text-sm">
                    <p className="font-medium">Suggestions</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {[...new Set(message.answer.suggestions)].map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Answer pending. Open the run to inspect progress or a failure.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRun(message.runId)}
            >
              View run
            </Button>
          </article>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!question.trim()) return;
          void send
            .mutateAsync({
              projectId: project.id,
              ...(conversation ? { conversationId: conversation.id } : {}),
              question: question.trim(),
            })
            .then(async (run) => {
              onRun(run.id);
              setQuestion("");
              if (!conversation) setConversationId("");
              await queryClient.invalidateQueries();
            })
            .catch(showError);
        }}
      >
        <Textarea
          aria-label="Project question"
          placeholder="Who owns the launch task, and what is blocking it?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={send.isPending}
        />
        <Button disabled={!question.trim() || send.isPending}>Ask</Button>
      </form>
    </div>
  );
}

function EvidenceQuote({
  evidence,
  onEvidence,
}: {
  evidence: EvidenceRecord;
  onEvidence: (evidence: EvidenceRecord) => void;
}) {
  return (
    <div className="space-y-1">
      <blockquote className="whitespace-pre-wrap border-l-2 pl-3 text-xs text-muted-foreground">
        {evidence.quote}
      </blockquote>
      <button
        type="button"
        className="text-xs underline underline-offset-2"
        onClick={() => onEvidence(evidence)}
      >
        {evidence.kind === "human" ? "Human confirmation" : "Source snapshot"}
        {" · "}version {evidence.sourceVersion}
      </button>
    </div>
  );
}

export function EvidencePanel({
  projectId,
  evidence,
}: {
  projectId: string;
  evidence: EvidenceRecord | null;
}) {
  const trpc = useProjectTRPC();
  const snapshot = useQuery({
    ...trpc.evidence.read.queryOptions({
      projectId,
      documentRef: evidence?.documentRef ?? "",
    }),
    enabled: evidence !== null && evidence.projectId === projectId,
  });
  if (!evidence) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Select a citation or proposed fact to inspect its immutable source.
      </p>
    );
  }
  const data = snapshot.data;
  const exact =
    data &&
    data.projectId === projectId &&
    data.documentRef === evidence.documentRef &&
    data.sourceVersion === evidence.sourceVersion &&
    data.checksum === evidence.checksum &&
    data.markdown.slice(evidence.start, evidence.end) === evidence.quote;
  return (
    <div className="space-y-4 p-4">
      <h2 className="text-sm font-medium">
        {evidence.kind === "human" ? "Human confirmation" : "Source snapshot"}
      </h2>
      {snapshot.isError ? (
        <p className="text-sm text-destructive">{snapshot.error.message}</p>
      ) : null}
      {snapshot.isPending ? (
        <p className="text-sm text-muted-foreground">Loading source…</p>
      ) : null}
      <blockquote className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
        {evidence.quote}
      </blockquote>
      {data ? (
        <>
          <p className="break-all text-xs text-muted-foreground">
            {data.sourceId} · version {data.sourceVersion}
            {data.sourceDate ? ` · ${data.sourceDate}` : ""}
          </p>
          <Badge variant={exact ? "outline" : "destructive"}>
            {exact ? "Exact passage verified" : "Passage verification failed"}
          </Badge>
          <details open>
            <summary className="cursor-pointer text-xs font-medium">
              Full source
            </summary>
            <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
              {exact ? (
                <>
                  {data.markdown.slice(0, evidence.start)}
                  <mark className="rounded bg-amber-100 dark:bg-amber-900">
                    {evidence.quote}
                  </mark>
                  {data.markdown.slice(evidence.end)}
                </>
              ) : (
                data.markdown
              )}
            </pre>
          </details>
          <details>
            <summary className="cursor-pointer text-xs">
              Source identity
            </summary>
            <p className="mt-2 break-all font-mono text-xs">
              {data.documentRef}
              <br />
              {data.checksum}
            </p>
          </details>
        </>
      ) : null}
    </div>
  );
}

export function EvaluationsPanel({
  onRun,
}: {
  onRun: (projectId: string, runId: string) => void;
}) {
  const trpc = useProjectTRPC();
  const reports = useQuery(trpc.evaluations.list.queryOptions());
  const [reportId, setReportId] = useState("");
  const selected =
    reports.data?.find((item) => item.id === reportId) ?? reports.data?.[0];
  const report = useQuery({
    ...trpc.evaluations.get.queryOptions({ id: selected?.id ?? "" }),
    enabled: selected !== undefined,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Read-only results from manually run evaluations. Targets are pilot
        gates; fixture results do not establish live model accuracy.
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs">
          Evaluation
          <select
            className="h-9 max-w-72 rounded-md border bg-background px-2"
            value={selected?.id ?? ""}
            onChange={(event) => setReportId(event.target.value)}
          >
            {!selected ? <option value="">No saved evaluations</option> : null}
            {(reports.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.createdAt} · {item.mode} · {item.split}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void reports.refetch();
            if (selected) void report.refetch();
          }}
        >
          Refresh
        </Button>
      </div>
      {reports.isError ? (
        <p className="text-sm text-destructive">{reports.error.message}</p>
      ) : null}
      {report.isError ? (
        <p className="text-sm text-destructive">{report.error.message}</p>
      ) : null}
      {report.data ? (
        <EvaluationDetail report={report.data} onRun={onRun} />
      ) : null}
    </div>
  );
}

function EvaluationDetail({
  report,
  onRun,
}: {
  report: EvaluationRecord;
  onRun: (projectId: string, runId: string) => void;
}) {
  const traceProjects = report.metadata.traceProjects;
  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border p-3 text-xs">
        <p>
          Mode: {report.mode} · Split: {report.split}
        </p>
        <p>Model: {report.model}</p>
        <p>
          Dataset: {report.datasetVersion} · Prompt: {report.promptVersion}
        </p>
        <p className="break-all text-muted-foreground">
          Corpus checksum: {report.datasetChecksum}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="p-2">Measure</th>
              <th className="p-2">Count</th>
              <th className="p-2">Result</th>
              <th className="p-2">Target</th>
              <th className="p-2">Gate</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.metrics).map(([name, metric]) => (
              <tr key={name} className="border-t">
                <td className="p-2">{label(name)}</td>
                <td className="p-2">
                  {metric.numerator} / {metric.denominator}
                </td>
                <td className="p-2">{percent(metric.value)}</td>
                <td className="p-2">{percent(metric.target)}</td>
                <td className="p-2">
                  <Badge
                    variant={
                      metric.passed === false ? "destructive" : "outline"
                    }
                  >
                    {metric.passed === null
                      ? "Unscored"
                      : metric.passed
                        ? "Passed"
                        : "Failed"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          Failures ({report.failures.length})
        </h3>
        {report.failures.length === 0 ? (
          <p className="text-xs text-muted-foreground">No failures recorded.</p>
        ) : null}
        {report.failures.map((failure) => {
          const traceId = failure.traceId;
          const projectId =
            traceId &&
            typeof traceProjects === "object" &&
            traceProjects !== null
              ? (traceProjects as Record<string, unknown>)[traceId]
              : null;
          return (
            <div
              key={`${failure.caseId}:${failure.module}:${traceId ?? failure.reason}`}
              className="rounded-md border p-3 text-xs"
            >
              <p className="font-medium">
                {failure.caseId} · {label(failure.module)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{failure.reason}</p>
              {traceId ? (
                typeof projectId === "string" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => onRun(projectId, traceId)}
                  >
                    Inspect failing run
                  </Button>
                ) : (
                  <p className="mt-1 break-all text-muted-foreground">
                    Trace: {failure.traceId}
                  </p>
                )
              ) : null}
            </div>
          );
        })}
      </div>
      <details>
        <summary className="cursor-pointer text-xs">
          Run settings and budgets
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(report.metadata, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function percent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Request failed");
}
