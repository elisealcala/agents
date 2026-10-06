import { describe, expect, it } from "vitest";
import type {
  Answer,
  ApprovedFact,
  Candidate,
} from "../src/application/contracts.ts";
import type { ExpectedState, GoldFact, GoldQuestion } from "./dataset.ts";
import { matchingGold, Scores } from "./scoring.ts";

const quote = 'Task "Cache" has owner "Ava" effective 2026-10-05.';
function gold(): GoldFact {
  return {
    id: "gold-1",
    entity: "Cache",
    field: "owner",
    value: "Ava",
    effectiveDate: "2026-10-05",
    quote,
    start: 0,
    end: quote.length,
    decision: "accept",
  };
}
function candidate(): Candidate {
  return {
    id: "candidate-1",
    noteId: "note-1",
    entity: "Cache",
    field: "owner",
    value: "Ava",
    effectiveDate: "2026-10-05",
    status: "pending",
    conflict: false,
    historical: false,
    createdAt: "2026-10-05",
    evidence: {
      kind: "document",
      projectId: "atlas",
      documentRef: "doc-1",
      checksum: "hash",
      sourceVersion: "1",
      start: 0,
      end: quote.length,
      quote,
    },
  };
}
function approved(): ApprovedFact {
  return {
    id: "approved-1",
    candidateId: "candidate-1",
    entity: "Cache",
    field: "owner",
    value: "Ava",
    effectiveDate: "2026-10-05",
    evidence: candidate().evidence,
    revision: 1,
  };
}
function expected(): ExpectedState {
  return {
    entity: "Cache",
    field: "owner",
    value: "Ava",
    effectiveDate: "2026-10-05",
    sourceId: "note-1",
  };
}
function question(): GoldQuestion {
  return {
    id: "question-1",
    question: "Who owns Cache?",
    required: [expected()],
    retrievalSources: ["note-1"],
    clarificationRequired: false,
  };
}
function answer(): Answer {
  const fact = approved();
  return {
    text: "Cache owner: Ava",
    claims: [
      {
        factId: fact.id,
        evidence: fact.evidence,
        entity: fact.entity,
        field: fact.field,
        value: fact.value,
      },
    ],
    suggestions: [],
    questions: [],
    pendingReview: 0,
    missingEmbeddings: 0,
    status: "answered",
  };
}

describe("accuracy scoring", () => {
  it("counts duplicate assertions as incorrect and tracks omitted fields separately", () => {
    const scores = new Scores();
    const missing: GoldFact = {
      ...gold(),
      id: "due-gold",
      field: "due_date",
      value: "2026-10-20",
    };
    const outcome = scores.extraction(
      "extraction",
      [candidate(), { ...candidate(), id: "duplicate" }],
      [gold(), missing],
    );
    expect(outcome.matched).toBe(1);
    expect(outcome.incorrect).toHaveLength(1);
    expect(outcome.omitted).toEqual([missing]);
    expect(scores.report()["extraction.precision"]).toMatchObject({
      numerator: 1,
      denominator: 2,
      value: 0.5,
      passed: false,
    });
    expect(scores.report()["extraction.recall"]).toMatchObject({
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
    expect(scores.report()["extraction.due_date.recall"]).toMatchObject({
      numerator: 0,
      denominator: 1,
      passed: false,
    });
  });

  it("does not grant an abstaining system perfect precision or recall", () => {
    const scores = new Scores();
    scores.extraction("extraction", [], [gold()]);
    expect(scores.report()["extraction.precision"]).toMatchObject({
      denominator: 0,
      value: null,
      passed: null,
    });
    expect(scores.report()["extraction.recall"]).toMatchObject({
      numerator: 0,
      denominator: 1,
      value: 0,
      passed: false,
    });
    expect(scores.answer("answers", null, question(), [approved()])).toBe(
      false,
    );
    expect(scores.report()["answers.whole_case"]).toMatchObject({
      numerator: 0,
      denominator: 1,
      passed: false,
    });
  });

  it("requires supporting spans and accepts longer exact passages containing the labeled fact", () => {
    expect(
      matchingGold(
        {
          ...candidate(),
          evidence: { ...candidate().evidence, quote: "Unsupported quotation" },
        },
        [gold()],
      ),
    ).toBeUndefined();
    const prefix = "Context: ";
    const expanded = {
      ...candidate(),
      evidence: {
        ...candidate().evidence,
        quote: prefix + quote,
        end: prefix.length + quote.length,
      },
    };
    expect(
      matchingGold(expanded, [
        { ...gold(), start: prefix.length, end: prefix.length + quote.length },
      ])?.id,
    ).toBe("gold-1");
    expect(
      matchingGold({ ...candidate(), value: "Wrong owner" }, [gold()]),
    ).toBeUndefined();
  });

  it("requires exact current state rather than a correct subset or stale values", () => {
    const scores = new Scores();
    expect(scores.state("state", [approved()], [expected()])).toBe(true);
    expect(
      scores.state(
        "state",
        [{ ...approved(), effectiveDate: "2026-09-01" }],
        [expected()],
      ),
    ).toBe(false);
    expect(scores.state("state", [], [expected()])).toBe(false);
    expect(scores.report()["state.exact_checkpoint"]).toMatchObject({
      numerator: 1,
      denominator: 3,
    });
  });

  it("scores incorrect proposals before simulated review can reject them", () => {
    const scores = new Scores();
    const incorrect = { ...candidate(), value: "Invented owner" };
    scores.proposals("reconciliation", [incorrect], [gold()], [], [expected()]);
    // A perfect checkpoint after rejection cannot erase the earlier proposal error.
    scores.state("checkpoint", [approved()], [expected()]);
    expect(scores.report()["reconciliation.proposal_precision"]).toMatchObject({
      numerator: 0,
      denominator: 1,
      value: 0,
    });
    expect(scores.report()["reconciliation.change_precision"]).toMatchObject({
      numerator: 0,
      denominator: 1,
      value: 0,
    });
    expect(scores.report()["checkpoint.exact_checkpoint"]).toMatchObject({
      value: 1,
    });
  });

  it("penalizes duplicate proposed changes and missing required changes", () => {
    const scores = new Scores();
    scores.proposals(
      "duplicates",
      [candidate(), { ...candidate(), id: "duplicate" }],
      [gold()],
      [],
      [expected()],
    );
    expect(scores.report()["duplicates.proposal_precision"]).toMatchObject({
      numerator: 1,
      denominator: 2,
    });
    expect(scores.report()["duplicates.change_precision"]).toMatchObject({
      numerator: 1,
      denominator: 2,
    });
    const missing = scores.proposals("missing", [], [gold()], [], [expected()]);
    expect(missing.omitted).toEqual([gold()]);
    expect(scores.report()["missing.change_precision"]).toMatchObject({
      value: null,
      passed: null,
    });
    expect(scores.report()["missing.change_recall"]).toMatchObject({
      numerator: 0,
      denominator: 1,
      passed: false,
    });
  });

  it("scores correct pending conflicts separately from state changes", () => {
    const pendingQuote = quote.replace('"Ava"', '"Zoe"');
    const pendingGold: GoldFact = {
      ...gold(),
      value: "Zoe",
      quote: pendingQuote,
      end: pendingQuote.length,
      decision: "pending",
    };
    const pending: Candidate = {
      ...candidate(),
      value: "Zoe",
      conflict: true,
      evidence: {
        ...candidate().evidence,
        quote: pendingQuote,
        end: pendingQuote.length,
      },
    };
    const scores = new Scores();
    expect(
      scores.proposals(
        "pending",
        [pending],
        [pendingGold],
        [expected()],
        [expected()],
      ).matched,
    ).toBe(1);
    expect(scores.report()["pending.proposal_precision"]).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
    expect(scores.report()["pending.conflict_recall"]).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
    expect(scores.report()["pending.change_precision"]).toMatchObject({
      denominator: 0,
      value: null,
    });
  });

  it("distinguishes historical proposals from stale current-state reversions", () => {
    const historicalQuote = quote.replace("2026-10-05", "2026-09-01");
    const historicalGold: GoldFact = {
      ...gold(),
      value: "Ava",
      effectiveDate: "2026-09-01",
      quote: historicalQuote,
    };
    const historical: Candidate = {
      ...candidate(),
      effectiveDate: "2026-09-01",
      historical: true,
      evidence: { ...candidate().evidence, quote: historicalQuote },
    };
    const previous = [{ ...expected(), value: "New owner" }];
    const scores = new Scores();
    expect(
      scores.proposals(
        "history",
        [historical],
        [historicalGold],
        previous,
        previous,
      ).matched,
    ).toBe(1);
    expect(scores.report()["history.history_recall"]).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
    expect(scores.report()["history.no_stale_reversions"]).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
    scores.proposals(
      "stale",
      [{ ...historical, historical: false }],
      [historicalGold],
      previous,
      previous,
    );
    expect(scores.report()["stale.no_stale_reversions"]).toMatchObject({
      numerator: 0,
      denominator: 1,
      passed: false,
    });
    expect(scores.report()["stale.change_precision"]).toMatchObject({
      numerator: 0,
      denominator: 1,
    });
  });

  it.each(["value", "quote", "start", "projectId"])(
    "rejects a tampered claim %s despite the approved fact ID",
    (field) => {
      const output = answer();
      const claim = output.claims[0]!;
      if (field === "value") claim.value = "Mallory";
      if (field === "quote")
        claim.evidence = { ...claim.evidence, quote: "Unrelated citation" };
      if (field === "start") claim.evidence = { ...claim.evidence, start: 4 };
      if (field === "projectId")
        claim.evidence = { ...claim.evidence, projectId: "other-project" };
      const scores = new Scores();
      expect(scores.answer("answers", output, question(), [approved()])).toBe(
        false,
      );
      expect(scores.report()["answers.precision"]).toMatchObject({
        numerator: 0,
        denominator: 1,
        value: 0,
      });
    },
  );

  it("counts repeated answer claims against precision and measures unnecessary clarification", () => {
    const repeated = answer();
    repeated.claims.push({ ...repeated.claims[0]! });
    const scores = new Scores();
    expect(scores.answer("answers", repeated, question(), [approved()])).toBe(
      false,
    );
    expect(scores.report()["answers.precision"]).toMatchObject({
      numerator: 1,
      denominator: 2,
    });
    const unnecessary = answer();
    unnecessary.questions = ["Who owns Cache?"];
    expect(
      scores.answer("clarification", unnecessary, question(), [approved()]),
    ).toBe(false);
    expect(
      scores.report()["clarification.unnecessary_clarification_rate"],
    ).toMatchObject({ numerator: 1, denominator: 1 });
    const needed: Answer = {
      ...answer(),
      claims: [],
      questions: ["Please confirm the owner."],
      status: "clarification",
    };
    expect(
      scores.answer(
        "needed",
        needed,
        { ...question(), required: [], clarificationRequired: true },
        [],
      ),
    ).toBe(true);
    expect(scores.report()["needed.necessary_clarification"]).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
  });

  it("rejects impossible score denominators", () => {
    const scores = new Scores();
    expect(() => scores.add("bad", 2, 1)).toThrow(/denominator/);
    expect(() => scores.add("bad", -1, 1)).toThrow(/denominator/);
  });
});
