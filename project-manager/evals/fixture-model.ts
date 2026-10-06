import type {
  AnswerProposal,
  ExtractedFact,
  Field,
  Model,
  Observe,
  Snapshot,
} from "../src/application/contracts.js";

/** Limited fixture grammar. This adapter is never evidence of LLM semantic accuracy. */
export class FixtureModel implements Model {
  readonly name = "fixture-grammar-v1";

  async extract(
    snapshot: Snapshot,
    observe: Observe,
  ): Promise<ExtractedFact[]> {
    const fields: Record<string, Field> = {
      description: "description",
      owner: "owner",
      "due date": "due_date",
      blocker: "blocker",
      status: "status",
    };
    const facts: ExtractedFact[] = [];
    const grammar =
      /Task "([^"\n]+)" has (description|owner|due date|blocker|status) "([^"\n]+)" effective (\d{4}-\d{2}-\d{2})\./g;
    for (const match of snapshot.markdown.matchAll(grammar)) {
      const field = fields[match[2] ?? ""];
      if (!field) continue;
      facts.push({
        entity: match[1] ?? "",
        field,
        value: match[3] ?? "",
        effectiveDate: match[4] ?? null,
        quote: match[0],
      });
    }
    observe(
      "fixture.extract",
      { sourceId: snapshot.sourceId, grammar: "v1" },
      { facts },
    );
    return facts;
  }

  async answer(input: Parameters<Model["answer"]>[0]): Promise<AnswerProposal> {
    const retrieval = await input.search(input.question);
    if (input.maxTurns > 1 && retrieval.passages[0])
      await input.read(retrieval.passages[0].documentRef);
    const question = input.question.toLowerCase();
    const fields: Field[] = [];
    if (question.includes("owner")) fields.push("owner");
    if (question.includes("due date")) fields.push("due_date");
    if (question.includes("blocker")) fields.push("blocker");
    else if (question.includes("complete") || question.includes("status"))
      fields.push("status");
    const entities = new Set(
      input.approved
        .filter((fact) => question.includes(fact.entity.toLowerCase()))
        .map((fact) => fact.entity),
    );
    const selected = input.approved.filter(
      (fact) => entities.has(fact.entity) && fields.includes(fact.field),
    );
    const missing = fields.filter(
      (field) => !selected.some((fact) => fact.field === field),
    );
    const result = {
      factIds: selected.map((fact) => fact.id),
      questions: missing.map(
        (field) =>
          `Please clarify the ${field.replaceAll("_", " ")} for the requested task.`,
      ),
    };
    input.observe(
      "fixture.answer",
      { question: input.question, maxTurns: input.maxTurns },
      result,
    );
    return result;
  }
}
