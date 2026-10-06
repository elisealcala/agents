import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ExtractedFact, Field } from "../src/application/contracts.js";

export type GoldFact = ExtractedFact & {
  id: string;
  start: number;
  end: number;
  decision: "accept" | "reject" | "pending";
};
export type ExpectedState = {
  entity: string;
  field: Field;
  value: string;
  effectiveDate: string | null;
  sourceId: string;
};
export type GoldDocument = {
  id: string;
  sourceId: string;
  sourceVersion: string;
  sourceDate: string;
  markdown: string;
  facts: GoldFact[];
  checkpoint: ExpectedState[];
  challenge: string | null;
};
export type GoldQuestion = {
  id: string;
  question: string;
  required: ExpectedState[];
  retrievalSources: string[];
  clarificationRequired: boolean;
  reason?: string;
};
export type GoldProject = {
  id: string;
  name: string;
  split: "development" | "holdout";
  documents: GoldDocument[];
  questions: GoldQuestion[];
};
export type Dataset = {
  version: string;
  frozenAt: string;
  description: string;
  projects: GoldProject[];
};

export function loadDataset(): { dataset: Dataset; checksum: string } {
  const file = new URL("./data/project-histories-v2.json", import.meta.url);
  const raw = readFileSync(file, "utf8");
  const checksum = createHash("sha256")
    .update(JSON.stringify(JSON.parse(raw)))
    .digest("hex");
  const expected = readFileSync(
    new URL("./data/project-histories-v2.sha256", import.meta.url),
    "utf8",
  ).split(" ")[0];
  if (checksum !== expected)
    throw new Error(
      "Frozen evaluation corpus checksum mismatch. Version the corpus instead of editing its frozen labels.",
    );
  const dataset = JSON.parse(raw) as Dataset;
  if (
    dataset.projects.length !== 8 ||
    dataset.projects.flatMap((p) => p.documents).length !== 64 ||
    dataset.projects.flatMap((p) => p.questions).length !== 40
  )
    throw new Error(
      "Evaluation corpus must contain eight projects, 64 documents and 40 questions.",
    );
  return { dataset, checksum };
}
