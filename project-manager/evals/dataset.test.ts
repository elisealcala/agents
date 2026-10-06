import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadDataset } from "./dataset.ts";

describe("frozen project histories", () => {
  it("contains the promised project-level development/holdout split and a canonical content checksum", () => {
    const { dataset, checksum } = loadDataset();
    expect(dataset.projects).toHaveLength(8);
    expect(
      dataset.projects.filter((project) => project.split === "development"),
    ).toHaveLength(5);
    expect(
      dataset.projects.filter((project) => project.split === "holdout"),
    ).toHaveLength(3);
    expect(new Set(dataset.projects.map((project) => project.id)).size).toBe(8);
    for (const project of dataset.projects) {
      expect(project.documents).toHaveLength(8);
      expect(project.questions).toHaveLength(5);
    }
    expect(checksum).toBe(
      createHash("sha256").update(JSON.stringify(dataset)).digest("hex"),
    );
    expect(
      readFileSync(
        new URL("./data/project-histories-v2.sha256", import.meta.url),
        "utf8",
      ).split(" ")[0],
    ).toBe(checksum);
  });

  it("labels inspectable source spans, dated state checkpoints and question evidence within each project", () => {
    const { dataset } = loadDataset();
    for (const project of dataset.projects) {
      const sources = new Set(
        project.documents.map((document) => document.sourceId),
      );
      for (const document of project.documents) {
        for (const fact of document.facts) {
          expect(document.markdown.slice(fact.start, fact.end)).toBe(
            fact.quote,
          );
          expect(fact.end).toBeGreaterThan(fact.start);
        }
        for (const checkpoint of document.checkpoint)
          expect(sources.has(checkpoint.sourceId)).toBe(true);
      }
      for (const question of project.questions) {
        for (const source of question.retrievalSources)
          expect(sources.has(source)).toBe(true);
        for (const fact of question.required)
          expect(sources.has(fact.sourceId)).toBe(true);
        if (question.clarificationRequired)
          expect(
            question.required.length === 0 || Boolean(question.reason),
          ).toBe(true);
      }
      const facts = project.documents.flatMap((document) => document.facts);
      expect(facts.some((fact) => fact.decision === "pending")).toBe(true);
      expect(
        facts.some((fact) => fact.field === "blocker" && fact.value === "none"),
      ).toBe(true);
      expect(
        facts.some((fact) => fact.field === "status" && fact.value === "done"),
      ).toBe(true);
    }
  });
});
