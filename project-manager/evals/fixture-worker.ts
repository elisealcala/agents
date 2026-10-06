import { createHash } from "node:crypto";
import type {
  Passage,
  Receipt,
  Snapshot,
  Worker,
} from "../src/application/contracts.js";

type Intake = Parameters<Worker["ingest"]>[0];

/** Deterministic boundary simulator with immutable receipts and lexical retrieval. */
export class FixtureWorker implements Worker {
  private snapshots = new Map<string, Snapshot>();
  private keys = new Map<string, Receipt>();
  private versions = new Map<string, Receipt>();
  private missing = new Set<string>();
  private failures = new Set<string>();
  readonly root = "fixture://isolated-project-evidence";

  async identity() {
    return { root: this.root };
  }
  failNext(sourceId: string) {
    this.failures.add(sourceId);
  }
  markMissing(documentRef: string) {
    this.missing.add(documentRef);
  }
  repair(documentRef: string) {
    this.missing.delete(documentRef);
  }

  async ingest(input: Intake): Promise<Receipt> {
    const checksum = createHash("sha256").update(input.markdown).digest("hex");
    const key = `${input.projectId}:${input.idempotencyKey}`;
    const versionKey = `${input.projectId}:${input.sourceId}:${input.sourceVersion}`;
    const existing = this.keys.get(key) ?? this.versions.get(versionKey);
    if (existing) {
      if (
        existing.checksum !== checksum ||
        existing.projectId !== input.projectId ||
        existing.sourceId !== input.sourceId ||
        existing.sourceVersion !== input.sourceVersion ||
        this.snapshots.get(existing.documentRef)?.sourceDate !==
          (input.sourceDate ?? null)
      )
        throw new Error(
          "Source version or retry key already binds different content or metadata",
        );
      this.keys.set(key, existing);
      return {
        ...existing,
        indexStatus: this.missing.has(existing.documentRef)
          ? "missing"
          : "ready",
      };
    }
    if (this.failures.delete(input.sourceId))
      throw new Error(
        "Fixture injected storage interruption before confirmation",
      );
    const documentRef = `fixture:${createHash("sha256").update(versionKey).digest("hex")}`;
    const snapshot: Snapshot = {
      projectId: input.projectId,
      documentRef,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      checksum,
      markdown: input.markdown,
      sourceDate: input.sourceDate ?? null,
    };
    const receipt: Receipt = {
      projectId: input.projectId,
      documentRef,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      checksum,
      storageStatus: "stored",
      indexStatus: "ready",
      error: null,
    };
    this.snapshots.set(documentRef, structuredClone(snapshot));
    this.keys.set(key, receipt);
    this.versions.set(versionKey, receipt);
    return { ...receipt };
  }

  async read(projectId: string, documentRef: string): Promise<Snapshot> {
    const snapshot = this.snapshots.get(documentRef);
    if (!snapshot || snapshot.projectId !== projectId)
      throw new Error("Evidence not found in selected project");
    return structuredClone(snapshot);
  }

  async search(
    projectId: string,
    question: string,
    topK = 5,
  ): Promise<{ passages: Passage[]; missingEmbeddings: number }> {
    const tokens = new Set(question.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const matches = [...this.snapshots.values()].filter(
      (snapshot) => snapshot.projectId === projectId,
    );
    const passages = matches
      .filter((snapshot) => !this.missing.has(snapshot.documentRef))
      .map((snapshot) => {
        const lower = snapshot.markdown.toLowerCase();
        const score = [...tokens].filter((token) =>
          lower.includes(token),
        ).length;
        return {
          projectId,
          documentRef: snapshot.documentRef,
          sourceId: snapshot.sourceId,
          sourceVersion: snapshot.sourceVersion,
          checksum: snapshot.checksum,
          start: 0,
          end: snapshot.markdown.length,
          quote: snapshot.markdown,
          score,
        };
      })
      .sort((a, b) => b.score - a.score || b.sourceId.localeCompare(a.sourceId))
      .slice(0, topK);
    return {
      passages,
      missingEmbeddings: matches.filter((snapshot) =>
        this.missing.has(snapshot.documentRef),
      ).length,
    };
  }
}
