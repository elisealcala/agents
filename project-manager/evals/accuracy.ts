import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Answer,
  ApprovedFact,
  EvaluationReport,
  Model,
  Project,
  Run,
  Worker,
} from "../src/application/contracts.js";
import { Manager } from "../src/application/manager.js";
import { Store } from "../src/storage/store.js";
import {
  createAnthropicModel,
  PROMPT_VERSION,
} from "../src/providers/anthropic.js";
import { createWorker } from "../src/providers/worker.js";
import {
  loadDataset,
  type GoldDocument,
  type GoldProject,
  type GoldQuestion,
} from "./dataset.js";
import { FixtureModel } from "./fixture-model.js";
import { FixtureWorker } from "./fixture-worker.js";
import { matchingGold, sameFact, Scores } from "./scoring.js";

export type EvaluationOptions = {
  mode: "fixture" | "live";
  split: "development" | "holdout" | "all";
  model?: string;
  maxCostUsd?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  workerUrl?: string;
  libraryRoot?: string;
  output?: string;
  database?: string;
  timeoutMs?: number;
};

type Context = {
  store: Store;
  manager: Manager;
  worker: Worker;
  model: Model;
  scores: Scores;
  failures: EvaluationReport["failures"];
  firstFailure: Map<string, string>;
  timeoutMs: number;
  libraryRoot?: string;
};

function prefixes(split: GoldProject["split"], module: string): string[] {
  return [module, `${split}.${module}`];
}
function failure(
  context: Context,
  caseId: string,
  module: string,
  reason: string,
  traceId?: string,
) {
  if (!context.firstFailure.has(caseId))
    context.firstFailure.set(caseId, module);
  context.failures.push({
    caseId,
    module,
    reason,
    ...(traceId ? { traceId } : {}),
  });
}
async function terminal(
  store: Store,
  initial: Run,
  timeoutMs: number,
): Promise<Run> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = store.getRun(initial.id);
    if (run.status !== "running") {
      // Let the Manager release its per-project operation guard after committing.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Evaluation timeout after ${timeoutMs} ms; run ${initial.id}`,
  );
}

async function register(
  context: Context,
  project: Project,
  gold: GoldProject,
  document: GoldDocument,
): Promise<Run | null> {
  try {
    const before = context.store.get(project.id);
    if (
      document.challenge === "retry-storage" &&
      context.worker instanceof FixtureWorker
    )
      context.worker.failNext(document.sourceId);
    let run = await terminal(
      context.store,
      context.manager.submit(project.id, {
        sourceId: document.sourceId,
        sourceVersion: document.sourceVersion,
        markdown: document.markdown,
        sourceDate: document.sourceDate,
      }),
      context.timeoutMs,
    );
    if (
      document.challenge === "retry-storage" &&
      context.worker instanceof FixtureWorker &&
      run.status === "error"
    ) {
      const interrupted = context.store.get(project.id);
      const failedNote = interrupted.notes.find(
        (item) => item.sourceId === document.sourceId,
      );
      const noFalseConfirmation =
        failedNote?.documentRef === null &&
        !interrupted.candidates.some(
          (candidate) => candidate.noteId === failedNote?.id,
        );
      for (const prefix of prefixes(
        gold.split,
        "registration.failure_no_false_confirmation",
      ))
        context.scores.add(prefix, noFalseConfirmation ? 1 : 0, 1, 1);
      if (!noFalseConfirmation)
        failure(
          context,
          document.id,
          "registration",
          "Interrupted intake falsely confirmed storage",
          run.id,
        );
      if (failedNote)
        run = await terminal(
          context.store,
          context.manager.retry(project.id, failedNote.id),
          context.timeoutMs,
        );
    }
    const current = context.store.get(project.id);
    const note = current.notes.find(
      (item) => item.sourceId === document.sourceId,
    );
    if (
      document.challenge === "missing-embedding-and-historical-quote" &&
      note?.documentRef &&
      context.worker instanceof FixtureWorker
    )
      context.worker.markMissing(note.documentRef);
    const preserved =
      JSON.stringify(before.approved) === JSON.stringify(current.approved);
    for (const prefix of prefixes(gold.split, "registration.review_isolation"))
      context.scores.add(prefix, preserved ? 1 : 0, 1, 1);
    let correct =
      !!note?.documentRef &&
      note.checksum ===
        createHash("sha256").update(document.markdown).digest("hex");
    if (correct && note?.documentRef) {
      const snapshot = await context.worker.read(project.id, note.documentRef);
      correct =
        snapshot.projectId === project.id &&
        snapshot.sourceId === document.sourceId &&
        snapshot.sourceVersion === document.sourceVersion &&
        snapshot.markdown === document.markdown &&
        snapshot.checksum === note.checksum;
    }
    for (const prefix of prefixes(gold.split, "registration.source_integrity"))
      context.scores.add(prefix, correct ? 1 : 0, 1, 1);
    if (!correct || !preserved)
      failure(
        context,
        document.id,
        "registration",
        run.error ??
          "Storage confirmation, immutable checksum or review isolation failed",
        run.id,
      );
    if (document.challenge === "duplicate-submit" && correct) {
      const duplicate = context.manager.submit(project.id, {
        sourceId: document.sourceId,
        sourceVersion: document.sourceVersion,
        markdown: document.markdown,
        sourceDate: document.sourceDate,
      });
      const duplicateState = context.store.get(project.id);
      const unchanged =
        duplicate.id === run.id &&
        duplicateState.notes.length === current.notes.length &&
        duplicateState.candidates.length === current.candidates.length;
      for (const prefix of prefixes(
        gold.split,
        "registration.duplicate_free_retry",
      ))
        context.scores.add(prefix, unchanged ? 1 : 0, 1, 1);
      if (!unchanged)
        failure(
          context,
          document.id,
          "registration",
          "Duplicate submission created a second run, note or candidate",
          duplicate.id,
        );
    }
    return run;
  } catch (error) {
    for (const prefix of prefixes(gold.split, "registration.source_integrity"))
      context.scores.add(prefix, 0, 1, 1);
    failure(context, document.id, "registration", message(error));
    return null;
  }
}

async function reviewGold(
  context: Context,
  projectId: string,
  document: GoldDocument,
) {
  const project = context.store.get(projectId);
  const note = project.notes.find(
    (item) => item.sourceId === document.sourceId,
  );
  const used = new Set<string>();
  for (const candidate of project.candidates.filter(
    (item) => item.noteId === note?.id && item.status === "pending",
  )) {
    const gold = matchingGold(candidate, document.facts);
    const unique = !!gold && !used.has(gold.id);
    if (gold && unique) used.add(gold.id);
    if (unique && gold?.decision === "pending") continue;
    // Reject wrong proposals. Never add a missing fact or correct a wrong value.
    context.manager.review(projectId, {
      candidateId: candidate.id,
      action: unique && gold?.decision === "accept" ? "accept" : "reject",
      expectedRevision: context.store.get(projectId).revision,
    });
  }
}

async function retrieval(
  context: Context,
  projectId: string,
  gold: GoldProject,
  question: GoldQuestion,
) {
  try {
    const result = await context.worker.search(projectId, question.question, 5);
    const project = context.store.get(projectId);
    const requestedFields = question.question.toLowerCase().includes("blocker")
      ? ["blocker"]
      : question.question.toLowerCase().includes("complete")
        ? ["status"]
        : [
            question.question.toLowerCase().includes("owner") ? "owner" : null,
            question.question.toLowerCase().includes("due date")
              ? "due_date"
              : null,
          ].filter(Boolean);
    const requiredSpans = question.retrievalSources.flatMap((sourceId) => {
      const source = gold.documents.find(
        (document) => document.sourceId === sourceId,
      );
      return (source?.facts ?? [])
        .filter((fact) => requestedFields.includes(fact.field))
        .map((fact) => ({ ...fact, sourceId }));
    });
    const found = requiredSpans.filter((span) =>
      result.passages.some(
        (passage) =>
          passage.projectId === projectId &&
          passage.sourceId === span.sourceId &&
          passage.start <= span.start &&
          passage.end >= span.end &&
          passage.quote.includes(span.quote),
      ),
    ).length;
    let violations = 0;
    for (const passage of result.passages) {
      const source = project.notes.find(
        (note) =>
          note.sourceId === passage.sourceId &&
          note.documentRef === passage.documentRef,
      );
      if (
        passage.projectId !== projectId ||
        !source ||
        passage.checksum !== source.checksum ||
        source.markdown.slice(passage.start, passage.end) !== passage.quote
      )
        violations += 1;
    }
    for (const prefix of prefixes(
      gold.split,
      "isolated.retrieval.required_evidence",
    ))
      context.scores.add(prefix, found, requiredSpans.length, 0.95);
    for (const prefix of prefixes(
      gold.split,
      "isolated.retrieval.project_filter",
    ))
      context.scores.add(prefix, violations ? 0 : 1, 1, 1);
    if (found !== requiredSpans.length || violations)
      failure(
        context,
        question.id,
        "retrieval",
        `${found}/${requiredSpans.length} required source spans found; ${violations} project/span violations`,
      );
  } catch (error) {
    for (const prefix of prefixes(
      gold.split,
      "isolated.retrieval.required_evidence",
    ))
      context.scores.add(prefix, 0, question.retrievalSources.length, 0.95);
    for (const prefix of prefixes(
      gold.split,
      "isolated.retrieval.project_filter",
    ))
      context.scores.add(prefix, 0, 1, 1);
    failure(context, question.id, "retrieval", message(error));
  }
}

async function answerCases(
  context: Context,
  projectId: string,
  gold: GoldProject,
  scope: "integrated" | "isolated",
) {
  for (const maxTurns of [1, 6]) {
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const question of gold.questions) {
        const module = `${scope}.answers.${maxTurns === 1 ? "one_pass" : "bounded"}`;
        let answer: Answer | null = null;
        let run: Run | undefined;
        try {
          run = await terminal(
            context.store,
            context.manager.ask(projectId, {
              question: question.question,
              maxTurns,
            }),
            context.timeoutMs,
          );
          answer = run.status !== "error" ? (run.output as Answer) : null;
        } catch (error) {
          failure(
            context,
            question.id,
            "answer",
            `${scope}/${maxTurns} turns/repeat ${repeat + 1}: ${message(error)}`,
            run?.id,
          );
        }
        const approved = context.store.get(projectId).approved;
        let passed = true;
        for (const prefix of prefixes(gold.split, module))
          passed =
            context.scores.answer(prefix, answer, question, approved) && passed;
        for (const prefix of prefixes(
          gold.split,
          `${module}.timeouts_or_errors`,
        ))
          context.scores.add(prefix, answer ? 1 : 0, 1, 1);
        if (!passed)
          failure(
            context,
            question.id,
            "answer",
            `${scope}/${maxTurns} turns/repeat ${repeat + 1}: unsupported claim, omission, wrong clarification or run error${run?.error ? `: ${run.error}` : ""}`,
            run?.id,
          );
      }
    }
  }
}

function goldExtraction(gold: GoldProject, delegate: Model): Model {
  return {
    name: `${delegate.name}:reference-extraction`,
    async extract(snapshot, observe) {
      const document = gold.documents.find(
        (item) => item.sourceId === snapshot.sourceId,
      );
      if (!document) throw new Error("Reference input missing");
      const facts = document.facts.map(
        ({ entity, field, value, quote, effectiveDate }) => ({
          entity,
          field,
          value,
          quote,
          effectiveDate,
        }),
      );
      observe(
        "reference.extraction",
        { sourceId: snapshot.sourceId },
        { count: facts.length },
      );
      return facts;
    },
    answer: (input) => delegate.answer(input),
  };
}

/** Populate known approved reference state for answering isolation, without changing integrated runs. */
async function seedReferenceState(
  context: Context,
  projectId: string,
  gold: GoldProject,
) {
  const project = context.store.get(projectId);
  const expected = gold.documents.at(-1)?.checkpoint ?? [];
  const facts: ApprovedFact[] = [];
  for (const fact of expected) {
    const document = gold.documents.find(
      (item) => item.sourceId === fact.sourceId,
    );
    const label = document?.facts.find((item) => sameFact(item, fact));
    const note = project.notes.find((item) => item.sourceId === fact.sourceId);
    if (!document || !label || !note?.documentRef)
      throw new Error(
        "Cannot construct approved reference state: source snapshot missing",
      );
    const snapshot = await context.worker.read(projectId, note.documentRef);
    facts.push({
      id: randomUUID(),
      candidateId: `reference:${label.id}`,
      entity: fact.entity,
      field: fact.field,
      value: fact.value,
      effectiveDate: fact.effectiveDate,
      revision: 1,
      evidence: {
        kind: "document",
        projectId,
        documentRef: snapshot.documentRef,
        checksum: snapshot.checksum,
        sourceVersion: snapshot.sourceVersion,
        start: label.start,
        end: label.end,
        quote: label.quote,
      },
    });
  }
  project.approved = facts;
  project.history = structuredClone(facts);
  project.revision = 1;
  context.store.save(project);
}

async function replay(
  context: Context,
  gold: GoldProject,
  scope: "integrated" | "isolated",
) {
  const project = context.store.create(`${gold.name} [${scope} evaluation]`);
  const previousManager = context.manager;
  if (scope === "isolated")
    context.manager = new Manager(
      context.store,
      context.worker,
      goldExtraction(gold, context.model),
      context.libraryRoot ? { libraryRoot: context.libraryRoot } : {},
    );
  try {
    let previousCheckpoint: GoldDocument["checkpoint"] = [];
    for (const document of gold.documents) {
      const run = await register(context, project, gold, document);
      const current = context.store.get(project.id);
      const note = current.notes.find(
        (item) => item.sourceId === document.sourceId,
      );
      const extractionOutput = run?.spans.find(
        (span) => span.name === "extraction",
      )?.output;
      const candidates = Array.isArray(extractionOutput)
        ? (extractionOutput as Project["candidates"])
        : current.candidates.filter((item) => item.noteId === note?.id);
      if (scope === "integrated") {
        let result: ReturnType<Scores["extraction"]> | undefined;
        for (const prefix of prefixes(gold.split, "integrated.extraction"))
          result = context.scores.extraction(
            prefix,
            candidates,
            document.facts,
          );
        if (result?.incorrect.length || result?.omitted.length)
          failure(
            context,
            document.id,
            "extraction",
            `${result.incorrect.length} incorrect/duplicate predictions; ${result.omitted.length} omitted facts`,
            run?.id,
          );
        // Isolate extraction using the actual immutable snapshot, without retrieval or gold labels in the model request.
        if (note?.documentRef) {
          try {
            const snapshot = await context.worker.read(
              project.id,
              note.documentRef,
            );
            const extracted = await context.model.extract(
              snapshot,
              () => undefined,
            );
            const predictions = extracted.map((fact, index) => ({
              ...fact,
              id: `isolated:${index}`,
              noteId: note.id,
              evidence: {
                kind: "document" as const,
                projectId: project.id,
                documentRef: snapshot.documentRef,
                checksum: snapshot.checksum,
                sourceVersion: snapshot.sourceVersion,
                start: snapshot.markdown.indexOf(fact.quote),
                end: snapshot.markdown.indexOf(fact.quote) + fact.quote.length,
                quote: fact.quote,
              },
              status: "pending" as const,
              conflict: false,
              historical: false,
              createdAt: new Date().toISOString(),
            }));
            for (const prefix of prefixes(gold.split, "isolated.extraction"))
              context.scores.extraction(prefix, predictions, document.facts);
          } catch (error) {
            for (const prefix of prefixes(gold.split, "isolated.extraction"))
              context.scores.extraction(prefix, [], document.facts);
            failure(
              context,
              document.id,
              "extraction",
              `Isolated extraction: ${message(error)}`,
            );
          }
        } else
          for (const prefix of prefixes(gold.split, "isolated.extraction"))
            context.scores.extraction(prefix, [], document.facts);
      }
      let proposalResult: ReturnType<Scores["proposals"]> | undefined;
      for (const prefix of prefixes(gold.split, `${scope}.reconciliation`))
        proposalResult = context.scores.proposals(
          prefix,
          candidates,
          document.facts,
          previousCheckpoint,
          document.checkpoint,
        );
      if (proposalResult?.incorrect.length || proposalResult?.omitted.length)
        failure(
          context,
          document.id,
          "reconciliation",
          `${scope}: ${proposalResult.incorrect.length} wrong/duplicate/misclassified pre-review proposals; ${proposalResult.omitted.length} omitted proposals`,
          run?.id,
        );
      try {
        await reviewGold(context, project.id, document);
        const reviewed = context.store.get(project.id);
        let correct = true;
        for (const prefix of prefixes(
          gold.split,
          `${scope}.reconciliation.approved_state`,
        ))
          correct =
            context.scores.state(
              prefix,
              reviewed.approved,
              document.checkpoint,
            ) && correct;
        if (!correct)
          failure(
            context,
            document.id,
            "reconciliation",
            `${scope}: approved state differs from dated checkpoint`,
            run?.id,
          );
      } catch (error) {
        for (const prefix of prefixes(
          gold.split,
          `${scope}.reconciliation.approved_state`,
        ))
          context.scores.state(
            prefix,
            context.store.get(project.id).approved,
            document.checkpoint,
          );
        failure(
          context,
          document.id,
          "reconciliation",
          message(error),
          run?.id,
        );
      }
      previousCheckpoint = document.checkpoint;
    }
    if (scope === "integrated")
      for (const question of gold.questions)
        await retrieval(context, project.id, gold, question);
    let referenceReady = true;
    if (scope === "isolated") {
      try {
        await seedReferenceState(context, project.id, gold);
      } catch (error) {
        referenceReady = false;
        failure(
          context,
          gold.id,
          "registration",
          `Answer isolation unavailable: ${message(error)}`,
        );
      }
    }
    if (referenceReady) await answerCases(context, project.id, gold, scope);
    else
      for (const turns of ["one_pass", "bounded"])
        for (let repeat = 0; repeat < 3; repeat++)
          for (const question of gold.questions) {
            for (const prefix of prefixes(
              gold.split,
              `${scope}.answers.${turns}`,
            ))
              context.scores.answer(prefix, null, question, []);
            for (const prefix of prefixes(
              gold.split,
              `${scope}.answers.${turns}.timeouts_or_errors`,
            ))
              context.scores.add(prefix, 0, 1, 1);
          }
  } finally {
    if (scope === "isolated") await context.manager.close();
    context.manager = previousManager;
  }
}

async function fixtureRegistrationChallenges(context: Context) {
  if (!(context.worker instanceof FixtureWorker)) return;
  const worker = context.worker;
  const project = context.store.create("Boundary interruptions and recovery");
  const markdown =
    '# Retry control\nTask "Recovery" has owner "Ana Rivera" effective 2026-01-01.\n';
  worker.failNext("failure-control");
  const failed = await terminal(
    context.store,
    context.manager.submit(project.id, {
      sourceId: "failure-control",
      sourceVersion: "1",
      markdown,
    }),
    context.timeoutMs,
  );
  const interrupted = context.store.get(project.id);
  const note = interrupted.notes[0];
  const noFalseConfirmation =
    failed.status === "error" &&
    note?.documentRef === null &&
    !interrupted.candidates.length;
  context.scores.add(
    "registration.failure_no_false_confirmation",
    noFalseConfirmation ? 1 : 0,
    1,
    1,
  );
  if (!noFalseConfirmation)
    failure(
      context,
      "boundary-storage-interruption",
      "registration",
      "Interrupted storage was falsely confirmed",
      failed.id,
    );
  if (!note) return;
  const recovered = await terminal(
    context.store,
    context.manager.retry(project.id, note.id),
    context.timeoutMs,
  );
  const after = context.store.get(project.id);
  context.scores.add(
    "registration.retry_recovery",
    recovered.status !== "error" &&
      after.notes.length === 1 &&
      after.candidates.length === 1
      ? 1
      : 0,
    1,
    1,
  );
  if (!after.notes[0]?.documentRef) return;
  worker.markMissing(after.notes[0].documentRef);
  const incomplete = await worker.search(project.id, "Recovery owner", 5);
  context.scores.add(
    "registration.missing_embedding_visible",
    incomplete.missingEmbeddings === 1 && incomplete.passages.length === 0
      ? 1
      : 0,
    1,
    1,
  );
  worker.repair(after.notes[0].documentRef);
  const restored = await worker.search(project.id, "Recovery owner", 5);
  context.scores.add(
    "registration.embedding_repair",
    restored.missingEmbeddings === 0 && restored.passages.length === 1 ? 1 : 0,
    1,
    1,
  );
}

export async function evaluate(
  options: EvaluationOptions,
): Promise<EvaluationReport> {
  if (options.timeoutMs !== undefined && !positive(options.timeoutMs))
    throw new Error("Evaluation timeout must be positive");
  const { dataset, checksum } = loadDataset();
  const selected = dataset.projects.filter(
    (project) => options.split === "all" || project.split === options.split,
  );
  const id = randomUUID();
  const database =
    options.database ??
    path.join(os.tmpdir(), `project-manager-evaluation-${id}.sqlite`);
  const store = new Store(database);
  let model: Model;
  let worker: Worker;
  if (options.mode === "live") {
    if (
      !options.model ||
      !positive(options.maxCostUsd) ||
      !positive(options.inputPricePerMillion) ||
      !positive(options.outputPricePerMillion) ||
      !options.workerUrl ||
      !options.libraryRoot
    ) {
      store.close();
      throw new Error(
        "Live evaluation requires --model, --max-cost-usd, --input-price-per-million, --output-price-per-million, --worker-url and --library-root. Prices must describe the selected model; the cap covers manager-model calls only, not classifier-model calls.",
      );
    }
    model = createAnthropicModel({
      model: options.model,
      budget: {
        maxCostUsd: options.maxCostUsd,
        inputPricePerMillion: options.inputPricePerMillion,
        outputPricePerMillion: options.outputPricePerMillion,
      },
    });
    worker = createWorker(options.workerUrl);
  } else {
    model = new FixtureModel();
    worker = new FixtureWorker();
  }
  const manager = new Manager(
    store,
    worker,
    model,
    options.libraryRoot ? { libraryRoot: options.libraryRoot } : {},
  );
  const context: Context = {
    store,
    manager,
    model,
    worker,
    scores: new Scores(),
    failures: [],
    firstFailure: new Map(),
    timeoutMs: options.timeoutMs ?? 120_000,
    libraryRoot: options.libraryRoot,
  };
  try {
    const identity = await worker.identity();
    if (
      options.libraryRoot &&
      path.resolve(identity.root) !== path.resolve(options.libraryRoot)
    )
      throw new Error(
        "Evaluation worker root differs from selected dedicated project-evidence library",
      );
    await fixtureRegistrationChallenges(context);
    for (const project of selected) {
      await replay(context, project, "integrated");
      await replay(context, project, "isolated");
    }
    const metrics = context.scores.report();
    const usage = "usage" in model ? model.usage : null;
    const report: EvaluationReport = {
      id,
      createdAt: new Date().toISOString(),
      datasetVersion: dataset.version,
      datasetChecksum: checksum,
      mode: options.mode,
      model: model.name,
      promptVersion:
        options.mode === "fixture" ? "fixture-grammar-v1" : PROMPT_VERSION,
      split: options.split,
      metrics,
      failures: context.failures,
      metadata: {
        measurement:
          options.mode === "fixture"
            ? "Fixture grammar and lexical boundary simulator validate controls only. These scores are not LLM accuracy evidence."
            : "Manual live model evaluation; synthetic histories do not establish real-world accuracy.",
        datasetFrozenAt: dataset.frozenAt,
        selectedProjects: selected.map((project) => project.id),
        documents: selected.flatMap((project) => project.documents).length,
        questions: selected.flatMap((project) => project.questions).length,
        repetitions: 3,
        turns: [1, 6],
        topK: 5,
        totalRetrievalPassageBudget: 5,
        timeoutMs: context.timeoutMs,
        database,
        workerRoot: identity.root,
        workerMode:
          options.mode === "fixture"
            ? "in-memory lexical simulator"
            : "live classifier boundary",
        modelUsage: usage,
        budget:
          options.mode === "live"
            ? {
                maxCostUsd: options.maxCostUsd,
                inputPricePerMillion: options.inputPricePerMillion,
                outputPricePerMillion: options.outputPricePerMillion,
                scope: "manager-model requests only",
                classifierSpend:
                  "Separate classifier model calls can incur additional cost; they are not covered by this cap.",
              }
            : { maxCostUsd: 0, scope: "offline fixture adapter" },
        firstFailingModule: Object.fromEntries(context.firstFailure),
        traceProjects: Object.fromEntries(
          context.failures.flatMap((item) =>
            item.traceId
              ? [[item.traceId, store.getRun(item.traceId).projectId]]
              : [],
          ),
        ),
        isolatedInputs:
          "Reconciliation receives gold extraction inputs. Answering receives known approved reference state. Integrated proposals are scored before review; review rejects errors and never fills omissions.",
        comparison: comparison(metrics),
        allDefinedGatesPassed: Object.values(metrics).every(
          (metric) => metric.passed !== false,
        ),
      },
    };
    store.saveEvaluation(report);
    const output =
      options.output ??
      path.join(
        fileURLToPath(new URL("./reports/", import.meta.url)),
        `${id}.json`,
      );
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await manager.close();
    store.close();
  }
}

function comparison(metrics: EvaluationReport["metrics"]) {
  const result: Record<string, unknown> = {};
  for (const split of ["development", "holdout"]) {
    const one = metrics[`${split}.integrated.answers.one_pass.whole_case`];
    const bounded = metrics[`${split}.integrated.answers.bounded.whole_case`];
    const onePrecision =
      metrics[`${split}.integrated.answers.one_pass.precision`];
    const boundedPrecision =
      metrics[`${split}.integrated.answers.bounded.precision`];
    result[split] = {
      onePassWholeCase: one ?? null,
      boundedWholeCase: bounded ?? null,
      additionalTurnsSupported:
        one?.value !== null &&
        bounded?.value !== null &&
        one?.value !== undefined &&
        bounded?.value !== undefined &&
        bounded.value > one.value &&
        (boundedPrecision?.value ?? 0) >= (onePrecision?.value ?? 0),
      decision:
        "Use additional turns only if holdout case success improves without reducing supported-claim precision. Fixture results cannot select a live orchestration policy.",
    };
  }
  return result;
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function parse(args: string[]): EvaluationOptions {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--"))
      throw new Error(
        "Use paired flags, for example --mode fixture --split development",
      );
    flags.set(key, value);
  }
  const mode = flags.get("--mode") ?? "fixture";
  const split = flags.get("--split") ?? "development";
  if (mode !== "fixture" && mode !== "live")
    throw new Error("--mode must be fixture or live");
  if (split !== "development" && split !== "holdout" && split !== "all")
    throw new Error("--split must be development, holdout or all");
  return {
    mode,
    split,
    model: flags.get("--model"),
    maxCostUsd: number(flags.get("--max-cost-usd")),
    inputPricePerMillion: number(flags.get("--input-price-per-million")),
    outputPricePerMillion: number(flags.get("--output-price-per-million")),
    workerUrl: flags.get("--worker-url"),
    libraryRoot: flags.get("--library-root"),
    output: flags.get("--output"),
    database: flags.get("--database"),
    timeoutMs: number(flags.get("--timeout-ms")),
  };
}
function number(value: string | undefined) {
  return value === undefined ? undefined : Number(value);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  evaluate(parse(process.argv.slice(2)))
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            evaluationId: report.id,
            mode: report.mode,
            split: report.split,
            failures: report.failures.length,
            gatesPassed: report.metadata.allDefinedGatesPassed,
            measurement: report.metadata.measurement,
          },
          null,
          2,
        ),
      );
      if (!report.metadata.allDefinedGatesPassed) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(message(error));
      process.exitCode = 1;
    });
}
