/** Review-first project wire contracts. Source spans refer to immutable snapshots. */
import { z } from "zod";

export const fieldSchema = z.enum([
  "description",
  "owner",
  "due_date",
  "blocker",
  "status",
]);
export type Field = z.infer<typeof fieldSchema>;
export const extractionSchema = z.object({
  facts: z
    .array(
      z.object({
        entity: z.string().trim().min(1).max(200),
        field: fieldSchema,
        value: z.string().trim().min(1).max(2000),
        quote: z.string().min(1),
        effectiveDate: z.string().nullable(),
      }),
    )
    .max(100),
});
export type ExtractedFact = z.infer<typeof extractionSchema>["facts"][number];
export type Evidence = {
  kind: "document" | "human";
  projectId: string;
  documentRef: string;
  checksum: string;
  sourceVersion: string;
  start: number;
  end: number;
  quote: string;
};
export type Snapshot = {
  projectId: string;
  documentRef: string;
  sourceId: string;
  sourceVersion: string;
  checksum: string;
  markdown: string;
  sourceDate: string | null;
};
export type Receipt = {
  projectId: string;
  documentRef: string;
  sourceId: string;
  sourceVersion: string;
  checksum: string;
  storageStatus: "stored" | "pending";
  indexStatus: "ready" | "missing";
  error: string | null;
};
export type Passage = {
  projectId: string;
  documentRef: string;
  sourceId: string;
  sourceVersion: string;
  checksum: string;
  start: number;
  end: number;
  quote: string;
  score: number;
};
export type ApprovedFact = {
  id: string;
  candidateId: string;
  entity: string;
  field: Field;
  value: string;
  effectiveDate: string | null;
  evidence: Evidence;
  revision: number;
};
export type Candidate = {
  id: string;
  noteId: string;
  entity: string;
  field: Field;
  value: string;
  effectiveDate: string | null;
  evidence: Evidence;
  status: "pending" | "accepted" | "rejected" | "edited";
  conflict: boolean;
  historical: boolean;
  createdAt: string;
};
export type Review = {
  id: string;
  candidateId: string;
  action: "accept" | "edit" | "reject";
  original: Candidate;
  correction: { value: string; effectiveDate: string | null } | null;
  revision: number;
  createdAt: string;
};
export type Note = {
  id: string;
  sourceId: string;
  sourceVersion: string;
  markdown: string;
  sourceDate: string | null;
  checksum: string;
  documentRef: string | null;
  status: "queued" | "storing" | "extracting" | "review" | "error";
  indexStatus: "ready" | "missing" | null;
  runId: string;
  error: string | null;
};
export type Message = {
  id: string;
  question: string;
  runId: string;
  answer: Answer | null;
  createdAt: string;
};
export type Conversation = { id: string; messages: Message[] };
export type Project = {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  notes: Note[];
  candidates: Candidate[];
  approved: ApprovedFact[];
  history: ApprovedFact[];
  reviews: Review[];
  conversations: Conversation[];
};
export type Answer = {
  text: string;
  claims: Array<{
    factId: string;
    evidence: Evidence;
    entity: string;
    field: Field;
    value: string;
  }>;
  suggestions: string[];
  questions: string[];
  pendingReview: number;
  missingEmbeddings: number;
  status: "answered" | "partial" | "clarification";
};
export const answerProposalSchema = z.object({
  factIds: z.array(z.string()).max(100),
  questions: z.array(z.string().min(1).max(1000)).max(10),
});
export type AnswerProposal = z.infer<typeof answerProposalSchema>;
export type Span = {
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  status: "running" | "ok" | "failed";
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
};
export type Run = {
  id: string;
  projectId: string;
  action: "intake" | "question";
  status: "running" | "success" | "partial" | "error";
  input: unknown;
  output: unknown;
  error: string | null;
  spans: Span[];
  startedAt: string;
  endedAt: string | null;
};
export type Metric = {
  numerator: number;
  denominator: number;
  value: number | null;
  target: number | null;
  passed: boolean | null;
};
export type EvaluationReport = {
  id: string;
  createdAt: string;
  datasetVersion: string;
  datasetChecksum: string;
  mode: "fixture" | "live";
  model: string;
  promptVersion: string;
  split: "development" | "holdout" | "all";
  metrics: Record<string, Metric>;
  failures: Array<{
    caseId: string;
    module: string;
    reason: string;
    traceId?: string;
  }>;
  metadata: Record<string, unknown>;
};
export interface Worker {
  identity(): Promise<{ root: string }>;
  ingest(input: {
    projectId: string;
    sourceId: string;
    sourceVersion: string;
    idempotencyKey: string;
    markdown: string;
    sourceDate?: string;
  }): Promise<Receipt>;
  read(projectId: string, documentRef: string): Promise<Snapshot>;
  search(
    projectId: string,
    question: string,
    topK?: number,
  ): Promise<{ passages: Passage[]; missingEmbeddings: number }>;
}
export type Observe = (
  name: string,
  input: unknown,
  output: unknown,
  error?: string,
) => void;
export interface Model {
  readonly name: string;
  extract(snapshot: Snapshot, observe: Observe): Promise<ExtractedFact[]>;
  answer(input: {
    question: string;
    approved: ApprovedFact[];
    history: Message[];
    maxTurns: number;
    search: (
      query: string,
    ) => Promise<{ passages: Passage[]; missingEmbeddings: number }>;
    read: (documentRef: string) => Promise<Snapshot>;
    observe: Observe;
  }): Promise<AnswerProposal>;
}
