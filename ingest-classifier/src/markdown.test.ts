import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { markdownToText, parseMarkdownFile } from "./markdown.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "markdown-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("markdownToText", () => {
  it("removes Markdown syntax while retaining content useful to classification", () => {
    const markdown = `---
title: Planning notes
private: true
---
# Project **Atlas**

> Review the [launch plan](https://example.test/launch).

- Owner: _Ada_
- Screenshot: ![checkout error](error.png)

1. Ship the \`parser\`
2. Verify ~~old~~ behavior

\`\`\`ts
const ready = true;
\`\`\`

<aside>Internal context</aside>
`;

    expect(markdownToText(markdown)).toBe(`Project Atlas

Review the launch plan.

Owner: Ada
Screenshot: checkout error

Ship the parser
Verify old behavior

const ready = true;

Internal context`);
  });

  it("normalizes line endings, horizontal rules, whitespace, and blank lines", () => {
    expect(markdownToText("First\r\n\r\n\r\n---\r\n\tSecond   line\rThird")).toBe(
      "First\n\nSecond line\nThird",
    );
  });

  it("returns an empty string for metadata-only input", () => {
    expect(markdownToText("---\ntitle: empty\n---\n")).toBe("");
  });
});

describe("parseMarkdownFile", () => {
  it("returns clean text, the exact original bytes, and a hash of those bytes", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "café.md");
    const sourceBytes = Buffer.from("# Café\r\n\r\nA **résumé** link: [read](https://example.test)\r\n");
    await writeFile(filePath, sourceBytes);

    const parsed = await parseMarkdownFile(filePath);

    expect(parsed.cleanText).toBe("Café\n\nA résumé link: read");
    expect(parsed.sourceBytes.equals(sourceBytes)).toBe(true);
    expect(parsed.sha256).toBe(
      createHash("sha256").update(sourceBytes).digest("hex"),
    );
    expect((await readFile(filePath)).equals(sourceBytes)).toBe(true);
  });

  it("rejects invalid UTF-8 instead of silently replacing source content", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "invalid.md");
    const sourceBytes = Buffer.from([0xc3, 0x28]);
    await writeFile(filePath, sourceBytes);

    await expect(parseMarkdownFile(filePath)).rejects.toThrow();
    expect((await readFile(filePath)).equals(sourceBytes)).toBe(true);
  });

  it("surfaces filesystem errors for missing inputs", async () => {
    const directory = await temporaryDirectory();

    await expect(
      parseMarkdownFile(path.join(directory, "missing.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
