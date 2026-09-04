import { mkdtemp, mkdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IngestPipeline } from "../pipeline.ts";
import { FixtureModelClient } from "./fixtureModel.ts";

const FIXTURE_NOTES = [
  ["project-brief.md", "# Project brief\nRequirements and launch acceptance criteria."],
  ["product-roadmap.md", "# Roadmap\nThe product roadmap covers three delivery phases."],
  ["feature-spec.md", "# Feature spec\nThe requirement is an accessible import flow."],
  ["release-plan.md", "# Release plan\nLaunch milestones and acceptance checks."],
  ["customer-requirements.md", "# Requirements\nCustomer needs for the next project."],
  ["api-design.md", "# API design\nTypeScript endpoints and response contracts."],
  ["database-notes.md", "# Database\nSQLite schema and migration architecture."],
  ["caching.md", "# Cache\nArchitecture notes for cache invalidation."],
  ["code-review.md", "# Code review\nRefactor the TypeScript provider interface."],
  ["system-design.md", "# Architecture\nQueue and database boundaries."],
  ["weekly-meeting.md", "# Weekly meeting\nAttendees and action items."],
  ["retro-minutes.md", "# Retro minutes\nMeeting decisions and follow-ups."],
  ["planning-call.md", "# Meeting\nAction item: update the plan."],
  ["one-on-one.md", "# 1:1 meeting\nDiscussion notes and action items."],
  ["idea-garden.md", "# Idea\nAn experiment for a calmer reading workflow."],
  ["journal.md", "# Journal\nReflection on how the week felt."],
  ["side-project.md", "# Personal idea\nExperiment with a tiny garden sensor."],
  ["reading-list.md", "# Reading list\n- [SQLite guide](https://sqlite.org)\n- Markdown reference"],
  ["research-links.md", "# Research\nExternal sources and useful links."],
  ["reference-guide.md", "# Reference\nA guide kept for later use."],
] as const;

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ingest-classifier-m1-"));
  const inbox = path.join(root, "inbox");
  await mkdir(inbox, { recursive: true });
  await Promise.all(
    FIXTURE_NOTES.map(([filename, content]) =>
      writeFile(path.join(inbox, filename), content, "utf8"),
    ),
  );
  await writeFile(path.join(inbox, "invalid.md"), Buffer.from([0xc3, 0x28]));
  await writeFile(path.join(inbox, "ignored.txt"), "leave me here", "utf8");

  const pipeline = new IngestPipeline({ root, client: new FixtureModelClient() });
  try {
    const results = await pipeline.scanOnce();
    const successful = results.filter((result) => result.status === "ok");
    const failures = results.filter((result) => result.status === "failed");
    const audits = pipeline.audit.list();
    const completeAudits = audits.filter((row) => row.status === "ok");
    const complete =
      successful.length === FIXTURE_NOTES.length &&
      completeAudits.length === FIXTURE_NOTES.length &&
      completeAudits.every(
        (row) =>
          row.destinationPath &&
          row.category &&
          row.summary &&
          row.confidence !== null,
      );
    await access(path.join(inbox, "invalid.md"));
    await access(path.join(inbox, "ignored.txt"));
    const report = {
      root,
      validMarkdown: FIXTURE_NOTES.length,
      sorted: successful.length,
      failedSafely: failures.length,
      auditRows: audits.length,
      completeAuditRows: completeAudits.length,
      pass: complete,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!complete) process.exitCode = 1;
  } finally {
    pipeline.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
