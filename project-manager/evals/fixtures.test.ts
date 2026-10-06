import { describe, expect, it, vi } from "vitest";
import type {
  ApprovedFact,
  Snapshot,
  Worker,
} from "../src/application/contracts.ts";
import { FixtureModel } from "./fixture-model.ts";
import { FixtureWorker } from "./fixture-worker.ts";

const markdown = 'Task "Unseen launch" has owner "Sofia" effective 2026-10-05.';
function input(overrides: Partial<Parameters<Worker["ingest"]>[0]> = {}) {
  return {
    projectId: "unknown-project",
    sourceId: "outside-gold-dataset",
    sourceVersion: "1",
    idempotencyKey: "retry-1",
    sourceDate: "2026-10-05",
    markdown,
    ...overrides,
  };
}

describe("offline boundary fixtures", () => {
  it("extracts unfamiliar source grammar without using source IDs or reference labels", async () => {
    const worker = new FixtureWorker();
    const receipt = await worker.ingest(input());
    const snapshot = await worker.read(input().projectId, receipt.documentRef);
    const model = new FixtureModel();
    const extracted = await model.extract(snapshot, vi.fn());
    expect(extracted).toEqual([
      {
        entity: "Unseen launch",
        field: "owner",
        value: "Sofia",
        effectiveDate: "2026-10-05",
        quote: markdown,
      },
    ]);
    expect(
      await model.extract(
        { ...snapshot, markdown: "Narrative notes without fixture grammar." },
        vi.fn(),
      ),
    ).toEqual([]);
  });

  it("keeps immutable receipts and binds retry aliases while refusing content and metadata conflicts", async () => {
    const worker = new FixtureWorker();
    const first = await worker.ingest(input());
    expect((await worker.ingest(input())).documentRef).toBe(first.documentRef);
    expect(
      (await worker.ingest(input({ idempotencyKey: "alias" }))).documentRef,
    ).toBe(first.documentRef);
    for (const changed of [
      { markdown: "Changed" },
      { sourceId: "other" },
      { sourceVersion: "2" },
      { sourceDate: "2026-10-06" },
    ]) {
      await expect(worker.ingest(input(changed))).rejects.toThrow(/different/);
    }
    await expect(
      worker.ingest(input({ idempotencyKey: "alias", sourceId: "other" })),
    ).rejects.toThrow(/different/);
    const snapshot = await worker.read(input().projectId, first.documentRef);
    snapshot.markdown = "Local mutation";
    expect(
      (await worker.read(input().projectId, first.documentRef)).markdown,
    ).toBe(markdown);
    await expect(
      worker.read("other-project", first.documentRef),
    ).rejects.toThrow(/selected project/);
  });

  it("makes injected registration failures retryable and exposes scoped missing-index coverage", async () => {
    const worker = new FixtureWorker();
    worker.failNext(input().sourceId);
    await expect(worker.ingest(input())).rejects.toThrow(/interruption/);
    const first = await worker.ingest(input());
    worker.markMissing(first.documentRef);
    await worker.ingest(
      input({ projectId: "other-project", idempotencyKey: "other-key" }),
    );
    expect(await worker.search(input().projectId, "launch")).toEqual({
      passages: [],
      missingEmbeddings: 1,
    });
    expect((await worker.ingest(input())).indexStatus).toBe("missing");
    worker.repair(first.documentRef);
    const found = await worker.search(input().projectId, "launch");
    expect(found).toMatchObject({
      missingEmbeddings: 0,
      passages: [
        expect.objectContaining({
          projectId: input().projectId,
          documentRef: first.documentRef,
          quote: markdown,
        }),
      ],
    });
  });

  it("selects only supplied approved facts and requests missing task fields", async () => {
    const snapshot: Snapshot = {
      projectId: "unknown",
      documentRef: "doc",
      sourceId: "source",
      sourceVersion: "1",
      checksum: "hash",
      markdown,
      sourceDate: "2026-10-05",
    };
    const fact: ApprovedFact = {
      id: "approved-owner",
      candidateId: "candidate",
      entity: "Unseen launch",
      field: "owner",
      value: "Sofia",
      effectiveDate: "2026-10-05",
      revision: 1,
      evidence: {
        kind: "document",
        projectId: "unknown",
        documentRef: "doc",
        checksum: "hash",
        sourceVersion: "1",
        start: 0,
        end: markdown.length,
        quote: markdown,
      },
    };
    const model = new FixtureModel();
    const search = vi.fn(async () => ({ passages: [], missingEmbeddings: 0 }));
    const read = vi.fn(async () => snapshot);
    const result = await model.answer({
      question: "What owner and due date does Unseen launch have?",
      approved: [fact],
      history: [],
      maxTurns: 6,
      observe: vi.fn(),
      search,
      read,
    });
    expect(result.factIds).toEqual([fact.id]);
    expect(result.questions).toEqual([expect.stringContaining("due date")]);
    expect(read).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledOnce();
  });
});
