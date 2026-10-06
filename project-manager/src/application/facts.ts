/** Validate document facts and keep temporal changes separate from human approval. */
import { randomUUID } from "node:crypto";
import type {
  ApprovedFact,
  Candidate,
  Evidence,
  ExtractedFact,
  Field,
  Project,
  Snapshot,
} from "./contracts.ts";

const STATUSES = new Set([
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);
export function factKey(fact: { entity: string; field: Field }): string {
  return `${fact.entity.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}\u0000${fact.field}`;
}
export function assertDate(value: string | null): void {
  if (
    value !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
  )
    throw new Error("Use a valid ISO date (YYYY-MM-DD)");
}
export function assertValue(field: Field, value: string): void {
  if (field === "due_date") assertDate(value);
  if (field === "status" && !STATUSES.has(value))
    throw new Error("Unsupported task status");
}
export function candidateFrom(
  snapshot: Snapshot,
  noteId: string,
  fact: ExtractedFact,
): Candidate {
  assertDate(fact.effectiveDate);
  assertValue(fact.field, fact.value);
  const start = snapshot.markdown.indexOf(fact.quote);
  if (start < 0 || !fact.quote.trim())
    throw new Error("Extracted fact has no exact supporting passage");
  const evidence: Evidence = {
    kind: "document",
    projectId: snapshot.projectId,
    documentRef: snapshot.documentRef,
    checksum: snapshot.checksum,
    sourceVersion: snapshot.sourceVersion,
    start,
    end: start + fact.quote.length,
    quote: fact.quote,
  };
  return {
    id: randomUUID(),
    noteId,
    entity: fact.entity,
    field: fact.field,
    value: fact.value,
    effectiveDate: fact.effectiveDate,
    evidence,
    status: "pending",
    conflict: false,
    historical: false,
    createdAt: new Date().toISOString(),
  };
}
export function currentFact(
  project: Project,
  fact: { entity: string; field: Field },
): ApprovedFact | undefined {
  return project.approved.find((item) => factKey(item) === factKey(fact));
}
/** A stale source may be approved as history, never as a current-state regression. */
export function annotateCandidate(
  project: Project,
  candidate: Candidate,
): void {
  const current = currentFact(project, candidate);
  candidate.historical = Boolean(
    current?.effectiveDate &&
      candidate.effectiveDate &&
      candidate.effectiveDate < current.effectiveDate,
  );
  candidate.conflict =
    !candidate.historical &&
    Boolean(
      (current && current.value !== candidate.value) ||
        project.candidates.some(
          (other) =>
            other.id !== candidate.id &&
            other.status === "pending" &&
            factKey(other) === factKey(candidate) &&
            other.value !== candidate.value &&
            !(
              current?.effectiveDate &&
              other.effectiveDate &&
              other.effectiveDate < current.effectiveDate
            ),
        ),
    );
}
export function disputedKeys(project: Project): Set<string> {
  const disputed = new Set<string>();
  for (const candidate of project.candidates.filter(
    (c) => c.status === "pending" && !c.historical,
  )) {
    const current = currentFact(project, candidate);
    if (current && current.value !== candidate.value)
      disputed.add(factKey(candidate));
    if (
      project.candidates.some(
        (other) =>
          other.status === "pending" &&
          !other.historical &&
          other.id !== candidate.id &&
          factKey(other) === factKey(candidate) &&
          other.value !== candidate.value,
      )
    )
      disputed.add(factKey(candidate));
  }
  return disputed;
}
