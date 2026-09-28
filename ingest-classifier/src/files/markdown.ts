/**
 * Reading a note off disk and reducing it to the plain text the model sees.
 *
 * Ingestion is strict about encoding: a file that is not valid UTF-8 fails
 * here rather than reaching the model as replacement characters.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/** The raw bytes, the text the model sees, and the hash that identifies it. */
export type ParsedMarkdown = {
  sourceBytes: Buffer;
  cleanText: string;
  sha256: string;
};

/** Read and parse one note. Throws on invalid UTF-8, leaving the file in place. */
export async function parseMarkdownFile(
  filePath: string,
): Promise<ParsedMarkdown> {
  const sourceBytes = await readFile(filePath);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  return {
    sourceBytes,
    cleanText: markdownToText(source),
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  };
}

/**
 * Strip Markdown down to readable prose.
 *
 * The order of these replacements is load-bearing, and each group depends on
 * the one before it:
 *  1. Normalize line endings, then drop front matter while `---` fences are
 *     still recognizable at the start of a line.
 *  2. Unwrap fenced code before inline code, so a fence's backticks are not
 *     mistaken for inline spans.
 *  3. Unwrap images before links, since an image is a link with a leading `!`.
 *  4. Strip line-leading block markers while they are still at line starts.
 *  5. Unwrap bold before italic, so `**text**` is not read as two italics.
 *  6. Collapse whitespace last, once every marker has been removed.
 */
export function markdownToText(markdown: string): string {
  return (
    markdown
      // 1. line endings, then front matter
      .replace(/\r\n?/g, "\n")
      .replace(/^---\s*$[\s\S]*?^---\s*$/m, " ")
      // 2. fenced code, then inline code
      .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      // 3. images, then links
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // 4. line-leading block markers
      .replace(/^[ \t]{0,3}(#{1,6})[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      .replace(/^[ \t]*[-+*][ \t]+/gm, "")
      .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
      .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
      .replace(/<[^>]+>/g, "")
      // 5. bold, then italic, then strikethrough
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")
      .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      // 6. collapse whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/^ +| +$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
