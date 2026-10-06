/** Five module orchestration: immutable intake, extraction, review and approved-only answers. */
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import {
  answerProposalSchema,
  extractionSchema,
  type Answer,
  type ApprovedFact,
  type Candidate,
  type Evidence,
  type Model,
  type Note,
  type Observe,
  type Project,
  type Run,
  type Snapshot,
  type Worker,
} from "./contracts.ts";
import {
  annotateCandidate,
  assertDate,
  assertValue,
  candidateFrom,
  currentFact,
  disputedKeys,
  factKey,
} from "./facts.ts";
import type { Store } from "../storage/store.ts";

export type SubmitInput = {
  sourceId: string;
  sourceVersion: string;
  markdown: string;
  sourceDate?: string;
};
export type ReviewInput = {
  candidateId: string;
  action: "accept" | "edit" | "reject";
  expectedRevision: number;
  value?: string;
  effectiveDate?: string | null;
};
export type AskInput = {
  conversationId?: string;
  question: string;
  maxTurns?: number;
};
const MAX_TURNS = 6;
const TOP_K = 5;
export class Manager {
  private busy = new Set<string>();
  private stopped = false;
  private active = new Set<Promise<void>>();
  constructor(
    readonly store: Store,
    private worker: Worker,
    private model: Model,
    private options: { libraryRoot?: string } = {},
  ) {}
  submit(projectId: string, input: SubmitInput): Run {
    this.assertAvailable(projectId);
    assertDate(input.sourceDate ?? null);
    const project = this.store.get(projectId);
    const checksum = hash(input.markdown);
    const previous = project.notes.find(
      (n) =>
        n.sourceId === input.sourceId &&
        n.sourceVersion === input.sourceVersion,
    );
    if (previous) {
      if (
        previous.checksum !== checksum ||
        previous.sourceDate !== (input.sourceDate ?? null)
      )
        throw new Error(
          "Source version already belongs to different content or source date",
        );
      return previous.status === "error"
        ? this.retry(projectId, previous.id)
        : this.store.getRun(previous.runId);
    }
    const run = this.openRun(projectId, "intake", input);
    const note: Note = {
      id: randomUUID(),
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      markdown: input.markdown,
      sourceDate: input.sourceDate ?? null,
      checksum,
      documentRef: null,
      status: "queued",
      indexStatus: null,
      runId: run.id,
      error: null,
    };
    project.notes.push(note);
    this.store.commit(project, run);
    this.launch(projectId, () => this.intake(project, note, run));
    return run;
  }
  retry(projectId: string, noteId: string): Run {
    this.assertAvailable(projectId);
    const project = this.store.get(projectId);
    const note = project.notes.find((n) => n.id === noteId);
    if (!note) throw new Error("Unknown note");
    if (note.status !== "error" && note.indexStatus !== "missing")
      return this.store.getRun(note.runId);
    const run = this.openRun(projectId, "intake", { noteId });
    note.status = "queued";
    note.runId = run.id;
    note.error = null;
    this.store.commit(project, run);
    this.launch(projectId, () => this.intake(project, note, run));
    return run;
  }
  review(projectId: string, input: ReviewInput): Project {
    this.assertAvailable(projectId);
    const project = this.store.get(projectId);
    if (project.revision !== input.expectedRevision)
      throw new Error("Project revision changed; refresh before reviewing");
    const candidate = project.candidates.find(
      (c) => c.id === input.candidateId,
    );
    if (candidate?.status !== "pending")
      throw new Error("Candidate is not pending review");
    if (candidate.evidence.projectId !== projectId)
      throw new Error("Candidate evidence belongs to another project");
    const original = structuredClone(candidate);
    const reviewId = randomUUID();
    const effectiveDate =
      input.action === "edit"
        ? input.effectiveDate === undefined
          ? candidate.effectiveDate
          : input.effectiveDate
        : candidate.effectiveDate;
    const value =
      input.action === "edit" ? input.value?.trim() : candidate.value;
    assertDate(effectiveDate);
    if (input.action !== "reject") {
      if (!value) throw new Error("A correction requires a value");
      assertValue(candidate.field, value);
      const current = currentFact(project, candidate);
      const historical = Boolean(
        current?.effectiveDate &&
          effectiveDate &&
          effectiveDate < current.effectiveDate,
      );
      const evidence: Evidence =
        input.action === "edit"
          ? {
              kind: "human",
              projectId,
              documentRef: `review:${reviewId}`,
              checksum: hash(value),
              sourceVersion: reviewId,
              start: 0,
              end: value.length,
              quote: value,
            }
          : candidate.evidence;
      const fact: ApprovedFact = {
        id: randomUUID(),
        candidateId: candidate.id,
        entity: candidate.entity,
        field: candidate.field,
        value,
        effectiveDate,
        evidence,
        revision: project.revision + 1,
      };
      // Approval history is append-only; the current row is unique by entity/field.
      if (!current || current.value !== value || input.action === "edit") {
        project.revision++;
        project.history.push(fact);
        if (!historical)
          project.approved = [
            ...project.approved.filter((f) => factKey(f) !== factKey(fact)),
            fact,
          ];
      }
      candidate.historical = historical;
    }
    candidate.status =
      input.action === "accept"
        ? "accepted"
        : input.action === "edit"
          ? "edited"
          : "rejected";
    project.reviews.push({
      id: reviewId,
      candidateId: candidate.id,
      action: input.action,
      original,
      correction:
        input.action === "edit" ? { value: value!, effectiveDate } : null,
      revision: project.revision,
      createdAt: new Date().toISOString(),
    });
    for (const pending of project.candidates.filter(
      (c) => c.status === "pending",
    ))
      annotateCandidate(project, pending);
    this.store.save(project);
    return project;
  }
  ask(projectId: string, input: AskInput): Run {
    this.assertAvailable(projectId);
    const maxTurns = input.maxTurns ?? MAX_TURNS;
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > MAX_TURNS)
      throw new Error("Model turn budget must be between one and six");
    const project = this.store.get(projectId);
    let conversation = input.conversationId
      ? project.conversations.find((c) => c.id === input.conversationId)
      : undefined;
    if (input.conversationId && !conversation)
      throw new Error("Conversation does not belong to this project");
    if (!conversation) {
      conversation = { id: randomUUID(), messages: [] };
      project.conversations.push(conversation);
    }
    const run = this.openRun(projectId, "question", {
      question: input.question,
      conversationId: conversation.id,
      maxTurns,
    });
    conversation.messages.push({
      id: randomUUID(),
      question: input.question,
      runId: run.id,
      answer: null,
      createdAt: new Date().toISOString(),
    });
    this.store.commit(project, run);
    this.launch(projectId, () =>
      this.answer(project, conversation!.id, run, input.question, maxTurns),
    );
    return run;
  }
  async read(projectId: string, documentRef: string): Promise<Snapshot> {
    const project = this.store.get(projectId);
    if (documentRef.startsWith("review:")) {
      const review = project.reviews.find(
        (r) => `review:${r.id}` === documentRef,
      );
      if (!review?.correction) throw new Error("Unknown human confirmation");
      const markdown = review.correction.value;
      return {
        projectId,
        documentRef,
        sourceId: review.id,
        sourceVersion: review.id,
        checksum: hash(markdown),
        sourceDate: review.createdAt.slice(0, 10),
        markdown,
      };
    }
    const note = project.notes.find((n) => n.documentRef === documentRef);
    if (!note) throw new Error("Evidence does not belong to this project");
    await this.checkIdentity();
    const snapshot = await this.worker.read(projectId, documentRef);
    if (
      snapshot.projectId !== projectId ||
      snapshot.documentRef !== documentRef ||
      snapshot.checksum !== note.checksum ||
      hash(snapshot.markdown) !== note.checksum ||
      snapshot.sourceId !== note.sourceId ||
      snapshot.sourceVersion !== note.sourceVersion ||
      snapshot.sourceDate !== note.sourceDate
    )
      throw new Error("Snapshot integrity check failed");
    return snapshot;
  }
  async close(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([...this.active]);
  }
  private async intake(project: Project, note: Note, run: Run): Promise<void> {
    const trace = this.observer(run);
    try {
      await this.checkIdentity();
      note.status = "storing";
      this.store.save(project);
      const receipt = await this.worker.ingest({
        projectId: project.id,
        sourceId: note.sourceId,
        sourceVersion: note.sourceVersion,
        idempotencyKey: note.id,
        markdown: note.markdown,
        ...(note.sourceDate ? { sourceDate: note.sourceDate } : {}),
      });
      trace("registration", { noteId: note.id }, receipt);
      if (
        receipt.projectId !== project.id ||
        receipt.checksum !== note.checksum ||
        receipt.sourceId !== note.sourceId ||
        receipt.sourceVersion !== note.sourceVersion ||
        receipt.storageStatus !== "stored"
      )
        throw new Error("Classifier did not confirm this exact source version");
      note.documentRef = receipt.documentRef;
      note.indexStatus = receipt.indexStatus;
      note.status = "extracting";
      this.store.save(project);
      const snapshot = await this.worker.read(project.id, receipt.documentRef);
      if (
        snapshot.projectId !== project.id ||
        snapshot.checksum !== note.checksum ||
        hash(snapshot.markdown) !== note.checksum ||
        snapshot.documentRef !== receipt.documentRef ||
        snapshot.sourceId !== note.sourceId ||
        snapshot.sourceVersion !== note.sourceVersion ||
        snapshot.sourceDate !== note.sourceDate
      )
        throw new Error("Snapshot integrity check failed");
      const extracted = extractionSchema.parse({
        facts: await this.model.extract(snapshot, trace),
      }).facts;
      const candidates: Candidate[] = extracted.map((fact) =>
        candidateFrom(snapshot, note.id, fact),
      );
      trace("extraction", { documentRef: receipt.documentRef }, candidates);
      for (const candidate of candidates) {
        if (
          project.candidates.some(
            (c) =>
              c.noteId === note.id &&
              factKey(c) === factKey(candidate) &&
              c.value === candidate.value &&
              c.evidence.quote === candidate.evidence.quote,
          )
        )
          continue;
        annotateCandidate(project, candidate);
        project.candidates.push(candidate);
      }
      for (const candidate of project.candidates.filter(
        (c) => c.status === "pending",
      ))
        annotateCandidate(project, candidate);
      trace(
        "reconciliation",
        { revision: project.revision },
        {
          proposed: candidates,
          pending: project.candidates.filter((c) => c.status === "pending")
            .length,
        },
      );
      note.status = "review";
      note.error = null;
      run.status = receipt.indexStatus === "ready" ? "success" : "partial";
      run.output = {
        noteId: note.id,
        candidates: project.candidates
          .filter((c) => c.noteId === note.id)
          .map((c) => c.id),
        indexStatus: receipt.indexStatus,
      };
    } catch (error) {
      note.status = "error";
      note.error = message(error);
      run.status = "error";
      run.error = note.error;
      trace("intake_error", { noteId: note.id }, null, note.error);
    }
    run.endedAt = new Date().toISOString();
    this.store.commit(project, run);
  }
  private async answer(
    project: Project,
    conversationId: string,
    run: Run,
    question: string,
    maxTurns: number,
  ): Promise<void> {
    const trace = this.observer(run);
    try {
      await this.checkIdentity();
      const blocked = disputedKeys(project);
      const approved = project.approved.filter((f) => !blocked.has(factKey(f)));
      const allowedRefs = new Set(
        approved
          .filter((f) => f.evidence.kind === "document")
          .map((f) => f.evidence.documentRef),
      );
      const conversation = project.conversations.find(
        (c) => c.id === conversationId,
      )!;
      let missingEmbeddings = project.notes.filter(
        (n) => n.indexStatus === "missing",
      ).length;
      let retrievedPassages = 0;
      const proposal = answerProposalSchema.parse(
        await this.model.answer({
          question,
          approved,
          history: conversation.messages
            .slice(-6)
            .map((m) => ({ ...m, answer: null })),
          maxTurns,
          observe: trace,
          search: async (query) => {
            const remaining = TOP_K - retrievedPassages;
            if (remaining <= 0) {
              trace(
                "retrieval",
                { query, projectId: project.id, remaining: 0 },
                { passages: [], missingEmbeddings },
              );
              return { passages: [], missingEmbeddings };
            }
            const result = await this.worker.search(
              project.id,
              query,
              remaining,
            );
            missingEmbeddings = Math.max(
              missingEmbeddings,
              result.missingEmbeddings,
            );
            const rawPassages = result.passages.slice(0, remaining);
            retrievedPassages += rawPassages.length;
            const seen = new Set<string>();
            const passages = rawPassages
              .filter(
                (p) =>
                  p.projectId === project.id && allowedRefs.has(p.documentRef),
              )
              .flatMap((p) =>
                approved
                  .filter(
                    (f) =>
                      f.evidence.documentRef === p.documentRef &&
                      f.evidence.checksum === p.checksum &&
                      f.evidence.sourceVersion === p.sourceVersion &&
                      f.evidence.start >= p.start &&
                      f.evidence.end <= p.end,
                  )
                  .map((f) => ({
                    ...p,
                    start: f.evidence.start,
                    end: f.evidence.end,
                    quote: f.evidence.quote,
                  })),
              )
              .filter((p) => {
                const key = `${p.documentRef}:${p.start}:${p.end}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
            trace(
              "retrieval",
              { query, projectId: project.id, remaining },
              { passages, missingEmbeddings, retrievedPassages },
            );
            return { passages, missingEmbeddings };
          },
          read: async (documentRef) => {
            if (!allowedRefs.has(documentRef))
              throw new Error("Only approved evidence is available to chat");
            const snapshot = await this.read(project.id, documentRef);
            // Give the model approved passages, not pending or rejected assertions elsewhere in the source.
            return {
              ...snapshot,
              markdown: approved
                .filter((f) => f.evidence.documentRef === documentRef)
                .map((f) => f.evidence.quote)
                .join("\n"),
            };
          },
        }),
      );
      const claims = [...new Set(proposal.factIds)].map((id) => {
        const fact = approved.find((f) => f.id === id);
        if (!fact)
          throw new Error("Answer referenced an unapproved or disputed fact");
        return {
          factId: fact.id,
          evidence: fact.evidence,
          entity: fact.entity,
          field: fact.field,
          value: fact.value,
        };
      });
      const pendingReview = project.candidates.filter(
        (c) => c.status === "pending",
      ).length;
      const questions = proposal.questions.length
        ? proposal.questions
        : claims.length
          ? []
          : [
              "Which approved project facts should I use? Review pending notes or add the missing information.",
            ];
      const text =
        claims
          .map(
            (c) => `${c.entity} · ${c.field.replaceAll("_", " ")}: ${c.value}`,
          )
          .join("\n") ||
        "There are no approved facts that answer this question.";
      const output: Answer = {
        text: `${text}${pendingReview ? `\n${pendingReview} fact(s) await review and may affect this answer.` : ""}${blocked.size ? "\nConflicting fields need review before a current answer." : ""}${missingEmbeddings ? "\nSome stored evidence is not indexed; retrieval coverage is incomplete." : ""}`,
        claims,
        suggestions: [],
        questions,
        pendingReview,
        missingEmbeddings,
        status: !claims.length
          ? "clarification"
          : pendingReview ||
              blocked.size ||
              missingEmbeddings ||
              questions.length
            ? "partial"
            : "answered",
      };
      trace("answer", { question }, output);
      const item = conversation.messages.find((m) => m.runId === run.id)!;
      item.answer = output;
      run.output = output;
      run.status = output.status === "answered" ? "success" : "partial";
    } catch (error) {
      run.status = "error";
      run.error = message(error);
      trace("answer_error", { question }, null, run.error);
    }
    run.endedAt = new Date().toISOString();
    this.store.commit(project, run);
  }
  private observer(run: Run): Observe {
    return (name, input, output, error) => {
      const now = new Date().toISOString();
      run.spans.push({
        id: randomUUID(),
        parentId: null,
        name,
        kind: name === "model" ? "model" : "tool",
        status: error ? "failed" : "ok",
        input,
        output,
        error: error ?? null,
        startedAt: now,
        endedAt: now,
      });
      this.store.saveRun(run);
    };
  }
  private async checkIdentity(): Promise<void> {
    const identity = await this.worker.identity();
    if (
      this.options.libraryRoot &&
      path.resolve(identity.root) !== path.resolve(this.options.libraryRoot)
    )
      throw new Error(
        "Classifier library root differs from the configured project library",
      );
  }
  private assertAvailable(projectId: string): void {
    if (this.stopped) throw new Error("Manager is shutting down");
    if (this.busy.has(projectId))
      throw new Error("Project has an operation in progress");
  }
  private openRun(
    projectId: string,
    action: Run["action"],
    input: unknown,
  ): Run {
    return {
      id: randomUUID(),
      projectId,
      action,
      input,
      status: "running",
      output: null,
      error: null,
      spans: [],
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
  }
  private launch(projectId: string, work: () => Promise<void>): void {
    this.busy.add(projectId);
    const pending = Promise.resolve()
      .then(work)
      .catch((error) => {
        console.error("Manager persistence failed:", message(error));
      })
      .finally(() => {
        this.busy.delete(projectId);
        this.active.delete(pending);
      });
    this.active.add(pending);
  }
}
function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
