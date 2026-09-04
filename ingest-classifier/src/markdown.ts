import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export type ParsedMarkdown = {
  sourceBytes: Buffer;
  cleanText: string;
  sha256: string;
};

export async function parseMarkdownFile(filePath: string): Promise<ParsedMarkdown> {
  const sourceBytes = await readFile(filePath);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  return {
    sourceBytes,
    cleanText: markdownToText(source),
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  };
}

export function markdownToText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^---\s*$[\s\S]*?^---\s*$/m, " ")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}(#{1,6})[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]*[-+*][ \t]+/gm, "")
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/^ +| +$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
