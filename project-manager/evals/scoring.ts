import type {
  Answer,
  ApprovedFact,
  Candidate,
  ExtractedFact,
  Metric,
} from "../src/application/contracts.js";
import type { ExpectedState, GoldFact, GoldQuestion } from "./dataset.js";

export function sameFact(
  actual: Pick<ExtractedFact, "entity" | "field" | "value" | "effectiveDate">,
  expected: Pick<ExtractedFact, "entity" | "field" | "value" | "effectiveDate">,
): boolean {
  return (
    actual.entity === expected.entity &&
    actual.field === expected.field &&
    actual.value === expected.value &&
    actual.effectiveDate === expected.effectiveDate
  );
}

export function matchingGold(
  candidate: Candidate,
  gold: GoldFact[],
): GoldFact | undefined {
  return gold.find(
    (fact) =>
      sameFact(candidate, fact) &&
      candidate.evidence.start >= 0 &&
      candidate.evidence.start <= fact.start &&
      candidate.evidence.end >= fact.end &&
      candidate.evidence.quote.length ===
        candidate.evidence.end - candidate.evidence.start &&
      candidate.evidence.quote.indexOf(fact.quote) ===
        fact.start - candidate.evidence.start,
  );
}

export type ProposalDisposition = {
  kind: "change" | "conflict" | "history" | "noop";
  historical: boolean;
  conflict: boolean;
  changesState: boolean;
};

/** Expected proposal behavior is derived from labeled prior state, never from human-corrected output. */
export function proposalDisposition(
  fact: GoldFact,
  previous: ExpectedState[],
  checkpoint: ExpectedState[],
  peers: GoldFact[] = [],
): ProposalDisposition {
  const prior = previous.find(
    (item) => item.entity === fact.entity && item.field === fact.field,
  );
  const historical = Boolean(
    prior?.effectiveDate &&
      fact.effectiveDate &&
      fact.effectiveDate < prior.effectiveDate,
  );
  const peerConflict = peers.some(
    (peer) =>
      peer.id !== fact.id &&
      peer.entity === fact.entity &&
      peer.field === fact.field &&
      peer.value !== fact.value &&
      !(
        prior?.effectiveDate &&
        peer.effectiveDate &&
        peer.effectiveDate < prior.effectiveDate
      ),
  );
  const conflict =
    !historical &&
    (Boolean(prior && prior.value !== fact.value) || peerConflict);
  const changesState =
    fact.decision === "accept" &&
    !historical &&
    checkpoint.some((item) => sameFact(item, fact)) &&
    !previous.some((item) => sameFact(item, fact));
  return {
    kind: historical
      ? "history"
      : conflict
        ? "conflict"
        : prior?.value === fact.value
          ? "noop"
          : "change",
    historical,
    conflict,
    changesState,
  };
}

export class Scores {
  private counters = new Map<
    string,
    { numerator: number; denominator: number; target: number | null }
  >();

  add(
    key: string,
    numerator: number,
    denominator: number,
    target: number | null = null,
  ) {
    if (numerator < 0 || denominator < 0 || numerator > denominator)
      throw new Error(`Invalid score denominator for ${key}`);
    const prior = this.counters.get(key) ?? {
      numerator: 0,
      denominator: 0,
      target,
    };
    prior.numerator += numerator;
    prior.denominator += denominator;
    this.counters.set(key, prior);
  }

  extraction(
    prefix: string,
    predictions: Candidate[],
    gold: GoldFact[],
  ): { matched: number; incorrect: Candidate[]; omitted: GoldFact[] } {
    const used = new Set<string>();
    this.add(`${prefix}.precision`, 0, 0, 0.98);
    for (const field of new Set(gold.map((fact) => fact.field)))
      this.add(`${prefix}.${field}.precision`, 0, 0, 0.98);
    const incorrect: Candidate[] = [];
    for (const prediction of predictions) {
      const match = matchingGold(prediction, gold);
      const correct = !!match && !used.has(match.id);
      if (correct && match) used.add(match.id);
      else incorrect.push(prediction);
      this.add(`${prefix}.precision`, correct ? 1 : 0, 1, 0.98);
      this.add(
        `${prefix}.${prediction.field}.precision`,
        correct ? 1 : 0,
        1,
        0.98,
      );
    }
    this.add(`${prefix}.recall`, used.size, gold.length, 0.9);
    for (const field of new Set(gold.map((fact) => fact.field))) {
      const expected = gold.filter((fact) => fact.field === field);
      this.add(
        `${prefix}.${field}.recall`,
        expected.filter((fact) => used.has(fact.id)).length,
        expected.length,
        0.9,
      );
    }
    return {
      matched: used.size,
      incorrect,
      omitted: gold.filter((fact) => !used.has(fact.id)),
    };
  }

  /** Scores all raw proposals before review; rejected wrong proposals still hurt precision. */
  proposals(
    prefix: string,
    predictions: Candidate[],
    gold: GoldFact[],
    previous: ExpectedState[],
    checkpoint: ExpectedState[],
  ): { matched: number; incorrect: Candidate[]; omitted: GoldFact[] } {
    const expected = gold.map((fact) => ({
      fact,
      disposition: proposalDisposition(fact, previous, checkpoint, gold),
    }));
    const used = new Set<string>();
    const changed = new Set<string>();
    const conflicts = new Set<string>();
    const histories = new Set<string>();
    const incorrect: Candidate[] = [];
    for (const key of [
      "proposal_precision",
      "change_precision",
      "conflict_precision",
      "history_precision",
    ])
      this.add(`${prefix}.${key}`, 0, 0, 0.98);
    for (const field of new Set(gold.map((fact) => fact.field)))
      this.add(`${prefix}.${field}.proposal_precision`, 0, 0, 0.98);
    for (const prediction of predictions) {
      const match = matchingGold(prediction, gold);
      const label = expected.find((item) => item.fact.id === match?.id);
      const correct =
        !!label &&
        !used.has(label.fact.id) &&
        prediction.historical === label.disposition.historical &&
        prediction.conflict === label.disposition.conflict;
      if (correct && label) used.add(label.fact.id);
      else incorrect.push(prediction);
      this.add(`${prefix}.proposal_precision`, correct ? 1 : 0, 1, 0.98);
      this.add(
        `${prefix}.${prediction.field}.proposal_precision`,
        correct ? 1 : 0,
        1,
        0.98,
      );
      // A correct pending conflict/history/no-op is not a proposed current-state update.
      // Wrong or duplicate proposals remain failures even if review later rejects them.
      if (!correct || label?.disposition.changesState) {
        const correctChange = correct && !!label?.disposition.changesState;
        if (correctChange && label) changed.add(label.fact.id);
        this.add(`${prefix}.change_precision`, correctChange ? 1 : 0, 1, 0.98);
      }
      if (prediction.conflict) {
        const correctConflict = correct && !!label?.disposition.conflict;
        if (correctConflict && label) conflicts.add(label.fact.id);
        this.add(
          `${prefix}.conflict_precision`,
          correctConflict ? 1 : 0,
          1,
          0.98,
        );
      }
      if (prediction.historical) {
        const correctHistory = correct && !!label?.disposition.historical;
        if (correctHistory && label) histories.add(label.fact.id);
        this.add(
          `${prefix}.history_precision`,
          correctHistory ? 1 : 0,
          1,
          0.98,
        );
      }
    }
    this.add(`${prefix}.proposal_recall`, used.size, gold.length, 0.9);
    this.add(
      `${prefix}.change_recall`,
      changed.size,
      expected.filter((item) => item.disposition.changesState).length,
      0.9,
    );
    this.add(
      `${prefix}.conflict_recall`,
      conflicts.size,
      expected.filter((item) => item.disposition.conflict).length,
      0.9,
    );
    this.add(
      `${prefix}.history_recall`,
      histories.size,
      expected.filter((item) => item.disposition.historical).length,
      0.9,
    );
    const historicalLabels = expected.filter(
      (item) => item.disposition.historical,
    );
    const staleAttempts = historicalLabels.filter((item) =>
      predictions.some(
        (prediction) =>
          sameFact(prediction, item.fact) && !prediction.historical,
      ),
    ).length;
    this.add(
      `${prefix}.no_stale_reversions`,
      historicalLabels.length - staleAttempts,
      historicalLabels.length,
      1,
    );
    for (const field of new Set(gold.map((fact) => fact.field))) {
      const facts = gold.filter((fact) => fact.field === field);
      this.add(
        `${prefix}.${field}.proposal_recall`,
        facts.filter((fact) => used.has(fact.id)).length,
        facts.length,
        0.9,
      );
    }
    return {
      matched: used.size,
      incorrect,
      omitted: gold.filter((fact) => !used.has(fact.id)),
    };
  }

  state(
    prefix: string,
    actual: ApprovedFact[],
    expected: ExpectedState[],
  ): boolean {
    const used = new Set<number>();
    let correct = 0;
    for (const fact of actual) {
      const index = expected.findIndex(
        (gold, i) => !used.has(i) && sameFact(fact, gold),
      );
      if (index >= 0) {
        used.add(index);
        correct += 1;
      }
    }
    this.add(`${prefix}.precision`, correct, actual.length, 0.98);
    this.add(`${prefix}.recall`, used.size, expected.length, 0.9);
    this.add(
      `${prefix}.exact_checkpoint`,
      correct === actual.length && used.size === expected.length ? 1 : 0,
      1,
      1,
    );
    return correct === actual.length && used.size === expected.length;
  }

  answer(
    prefix: string,
    answer: Answer | null,
    expected: GoldQuestion,
    approved: ApprovedFact[],
  ): boolean {
    const required = expected.required;
    const used = new Set<number>();
    let correct = 0;
    for (const claim of answer?.claims ?? []) {
      const fact = approved.find((f) => f.id === claim.factId);
      const index = required.findIndex(
        (gold, i) => !used.has(i) && !!fact && sameFact(fact, gold),
      );
      const cited =
        !!fact &&
        fact.entity === claim.entity &&
        fact.field === claim.field &&
        fact.value === claim.value &&
        fact.evidence.projectId === claim.evidence.projectId &&
        fact.evidence.documentRef === claim.evidence.documentRef &&
        fact.evidence.checksum === claim.evidence.checksum &&
        fact.evidence.quote === claim.evidence.quote &&
        fact.evidence.start === claim.evidence.start &&
        fact.evidence.end === claim.evidence.end &&
        fact.evidence.sourceVersion === claim.evidence.sourceVersion &&
        fact.evidence.kind === claim.evidence.kind;
      if (index >= 0 && cited) {
        used.add(index);
        correct += 1;
      }
    }
    this.add(`${prefix}.precision`, correct, answer?.claims.length ?? 0, 0.98);
    this.add(`${prefix}.completeness`, used.size, required.length, 0.9);
    const clarifies =
      (answer?.questions.length ?? 0) > 0 || answer?.status === "clarification";
    this.add(
      `${prefix}.necessary_clarification`,
      expected.clarificationRequired && clarifies ? 1 : 0,
      expected.clarificationRequired ? 1 : 0,
      1,
    );
    this.add(
      `${prefix}.avoids_unnecessary_clarification`,
      !expected.clarificationRequired && !clarifies ? 1 : 0,
      expected.clarificationRequired ? 0 : 1,
      1,
    );
    this.add(
      `${prefix}.unnecessary_clarification_rate`,
      !expected.clarificationRequired && clarifies ? 1 : 0,
      expected.clarificationRequired ? 0 : 1,
    );
    const success =
      !!answer &&
      correct === answer.claims.length &&
      used.size === required.length &&
      clarifies === expected.clarificationRequired;
    this.add(`${prefix}.whole_case`, success ? 1 : 0, 1, 0.9);
    return success;
  }

  report(): Record<string, Metric> {
    return Object.fromEntries(
      [...this.counters].map(([key, count]) => {
        const value = count.denominator
          ? count.numerator / count.denominator
          : null;
        return [
          key,
          {
            ...count,
            value,
            passed:
              value === null || count.target === null
                ? null
                : value >= count.target,
          },
        ];
      }),
    );
  }
}
