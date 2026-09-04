import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { AuditStore } from "./audit.ts";
import { classifyFile, type Classification } from "./classifier.ts";
import { moveWithoutOverwrite, restoreMovedFile } from "./fileMover.ts";
import { parseMarkdownFile } from "./markdown.ts";
import type { ModelClient } from "./providers/types.ts";
import {
  ensureLibraryLayout,
  getLibraryPaths,
  type LibraryPaths,
} from "./taxonomy.ts";

export type ProcessResult =
  | { status: "ok"; sourcePath: string; destinationPath: string; classification: Classification }
  | { status: "failed"; sourcePath: string; error: string }
  | { status: "skipped"; sourcePath: string; reason: string };

export type PipelineOptions = {
  root: string;
  client: ModelClient;
  pollIntervalMs?: number;
};

export class IngestPipeline {
  readonly paths: LibraryPaths;
  readonly audit: AuditStore;
  private readonly client: ModelClient;
  private readonly inFlight = new Set<string>();
  private readonly pollIntervalMs: number;

  constructor(options: PipelineOptions) {
    this.paths = getLibraryPaths(options.root);
    this.client = options.client;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.audit = new AuditStore(this.paths.database);
  }

  async initialize(): Promise<void> {
    await ensureLibraryLayout(this.paths.root);
  }

  close(): void {
    this.audit.close();
  }

  async scanOnce(): Promise<ProcessResult[]> {
    await this.initialize();
    const entries = await readdir(this.paths.inbox, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile());
    return Promise.all(
      files.map((entry) => this.processDetectedPath(path.join(this.paths.inbox, entry.name))),
    );
  }

  async watch(signal?: AbortSignal): Promise<void> {
    await this.scanOnce();
    while (!signal?.aborted) {
      await waitFor(this.pollIntervalMs, signal);
      if (!signal?.aborted) await this.scanOnce();
    }
  }

  private async processDetectedPath(sourcePath: string): Promise<ProcessResult> {
    if (this.inFlight.has(sourcePath)) {
      return { status: "skipped", sourcePath, reason: "already processing" };
    }
    this.inFlight.add(sourcePath);
    try {
      if (path.extname(sourcePath).toLowerCase() !== ".md") {
        const metadata = await stat(sourcePath);
        const fingerprint = `stat:${metadata.size}:${metadata.mtimeMs}`;
        this.audit.skip(sourcePath, fingerprint, "non-Markdown file");
        return { status: "skipped", sourcePath, reason: "non-Markdown file" };
      }
      return await this.processMarkdown(sourcePath);
    } finally {
      this.inFlight.delete(sourcePath);
    }
  }

  private async processMarkdown(sourcePath: string): Promise<ProcessResult> {
    let auditId: number | undefined;
    let sha256: string | undefined;
    let stage: "parse" | "classify" | "move" = "parse";
    try {
      const parsed = await parseMarkdownFile(sourcePath);
      sha256 = parsed.sha256;
      auditId =
        this.audit.begin({
          sourcePath,
          sourceSha256: parsed.sha256,
          provider: this.client.provider,
          model: this.client.model,
        }) ?? undefined;
      if (auditId === undefined) {
        return { status: "skipped", sourcePath, reason: "already audited or processing" };
      }
      this.audit.recordEvent(auditId, "parse", "ok", `${parsed.cleanText.length} characters`);

      stage = "classify";
      const classification = await classifyFile(this.client, parsed.cleanText);
      this.audit.setClassification(auditId, classification);
      this.audit.recordEvent(auditId, "classify", "ok");

      stage = "move";
      const moved = await moveWithoutOverwrite(
        sourcePath,
        this.paths.categories[classification.category],
        parsed.sha256,
      );
      try {
        this.audit.setDestination(auditId, moved.destinationPath);
        this.audit.recordEvent(auditId, "move", "ok");
        this.audit.complete(auditId);
      } catch (error) {
        await restoreMovedFile(moved.destinationPath, sourcePath);
        throw error;
      }
      return {
        status: "ok",
        sourcePath,
        destinationPath: moved.destinationPath,
        classification,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.audit.fail({
        auditId,
        sourcePath,
        sourceSha256: sha256,
        provider: this.client.provider,
        model: this.client.model,
        stage,
        error: message,
      });
      return { status: "failed", sourcePath, error: message };
    }
  }
}

async function waitFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
