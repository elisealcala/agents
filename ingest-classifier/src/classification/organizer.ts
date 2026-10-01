/**
 * The organizing tool loop (DEC-025).
 *
 * The pipeline still parses, deduplicates, moves, and audits. This module only
 * places one note: the model looks up the taxonomy, may look at similar filed
 * notes, and finishes by calling one terminal tool. The handler returns the
 * placement; it does not create folders or move files.
 */
import type { AgentHooks } from "../agent/hooks.ts";
import type {
  ModelClient,
  ToolDefinition,
  ToolLoopObserver,
  ToolOutcome,
} from "../providers/types.ts";

/** One category the organizer is allowed to see. */
export type TaxonomyEntry = {
  id: string;
  name: string;
  definition: string;
  parentId: string | null;
};

/** One already-filed note returned by the similarity tool. */
export type SimilarNote = {
  path: string;
  categoryId: string;
  summary: string;
  snippet: string;
};

/** One of the latest filed notes. Recency is a habit signal, not a match. */
export type RecentFiling = {
  path: string;
  categoryId: string;
  summary: string;
  filedAt: string;
};

/** What {@link placeNote} needs in order to run one attempt. */
export type PlaceNoteRequest<T> = {
  system: string;
  user: string;
  entries: TaxonomyEntry[];
  allowPropose: boolean;
  searchSimilar: () => Promise<SimilarNote[]>;
  listRecent?: () => Promise<RecentFiling[]> | RecentFiling[];
  acceptExisting: (input: unknown) => T;
  acceptPropose?: (input: unknown) => T;
  observe?: ToolLoopObserver;
  hooks?: AgentHooks;
};

const LIST_CATEGORIES = "list_categories";
const LIST_RECENT_FILINGS = "list_recent_filings";
const SEARCH_SIMILAR_NOTES = "search_similar_notes";
const FILE_EXISTING = "file_existing";
const PROPOSE_CHILD = "propose_child";

/**
 * Instructions for one organizing attempt.
 *
 * The note itself is the user message. Categories are a tool result, so a
 * later category cannot leak into a prompt built earlier.
 */
/**
 * Adaptive organizer instructions, with slots the studio can edit.
 *
 * `{{fit_threshold}}` is the fit rule. `{{examples}}` is the few-shot block,
 * empty when there are no corrections. The note and the taxonomy are not
 * slots: the note is the user message, and categories arrive from
 * `list_categories`.
 */
export const DEFAULT_ADAPTIVE_ORGANIZER_TEMPLATE = `You organize one Markdown note into this library.

Start with list_recent_filings to see what was organized most recently. Then call search_similar_notes for notes that resemble this one. Use list_categories to inspect the live taxonomy, or one category's children.

Recent filings show current habits. Similar notes show where this note belongs. When they disagree, follow the similar notes and any corrections below.

Finish by calling exactly one of file_existing or propose_child. file_existing chooses the best existing category that fits the note as a whole. propose_child chooses the closest parent and one new child when nothing that specific exists.

An existing match requires fit_score > {{fit_threshold}}. A child proposal may also have fit_score > {{fit_threshold}} when the parent fits but is too broad. Scores must be between 0 and 1.

Do not answer questions, invent paths, or move files.{{examples}}`;

const FIT_THRESHOLD_SLOT = "{{fit_threshold}}";
const EXAMPLES_SLOT = "{{examples}}";

/** Reject a studio template that would drop the fit rule or the examples. */
export function assertOrganizerTemplate(template: string): void {
  if (
    !template.includes(FIT_THRESHOLD_SLOT) ||
    !template.includes(EXAMPLES_SLOT)
  ) {
    throw new Error(
      "prompt template must include {{fit_threshold}} and {{examples}}",
    );
  }
}

/** Fill the two slots. The examples block is empty when nothing was saved. */
export function renderOrganizerPrompt(
  template: string,
  options: { fitThresholdText: string; examples: string[] },
): string {
  assertOrganizerTemplate(template);
  const examples =
    options.examples.length > 0
      ? `\n\nCorrections to learn from:\n${options.examples.map((example) => `- ${example}`).join("\n")}`
      : "";
  return template
    .replaceAll(FIT_THRESHOLD_SLOT, options.fitThresholdText)
    .replaceAll(EXAMPLES_SLOT, examples);
}

function correctionBlock(examples: string[]): string {
  return examples.length > 0
    ? `\n\nCorrections to learn from:\n${examples.map((example) => `- ${example}`).join("\n")}`
    : "";
}

export function buildOrganizerSystemPrompt(options: {
  allowPropose: boolean;
  fitThresholdText?: string;
  examples?: string[];
  promptTemplate?: string;
}): string {
  const examples = options.examples ?? [];
  if (!options.allowPropose) {
    return `You organize one Markdown note into exactly one seed category.

Look up the taxonomy with list_categories. When the fit is unclear, call search_similar_notes. Finish by calling file_existing exactly once.

Rules:
- category must be a seed id returned by list_categories.
- confidence_score must be between 0 and 1.
- tags must contain short strings.
- Do not answer questions, invent paths, or move files.${correctionBlock(examples)}`;
  }
  if (!options.fitThresholdText) {
    throw new Error("adaptive organizer prompt requires the fit threshold");
  }
  return renderOrganizerPrompt(
    options.promptTemplate ?? DEFAULT_ADAPTIVE_ORGANIZER_TEMPLATE,
    { fitThresholdText: options.fitThresholdText, examples },
  );
}

/**
 * Run one organizing attempt and return the accepted placement.
 *
 * A handler rejection stays inside the loop as a tool error. If the attempt
 * ends without a placement, the caller decides whether to retry.
 */
export async function placeNote<T>(
  client: ModelClient,
  request: PlaceNoteRequest<T>,
): Promise<T> {
  let placement: { value: T } | undefined;
  await client.runTools({
    system: request.system,
    user: request.user,
    tools: organizerTools(request.allowPropose),
    observe: request.observe,
    hooks: request.hooks,
    execute: (name, input) =>
      executeTool(
        name,
        input,
        request,
        () => placement,
        (value) => {
          placement = { value };
        },
      ),
  });
  if (!placement) {
    throw new Error("organizer stopped without a placement");
  }
  return placement.value;
}

/** Read a tool argument object, or throw a message the model can correct. */
export function toolRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function organizerTools(allowPropose: boolean): ToolDefinition[] {
  const fileExisting: ToolDefinition = {
    name: FILE_EXISTING,
    description: allowPropose
      ? "Finish by filing the note into an existing category that fits the note as a whole. Call this once, and not together with propose_child."
      : "Finish by filing the note into exactly one seed category. Call this once.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        confidence_score: { type: "number" },
        ...(allowPropose ? { fit_score: { type: "number" } } : {}),
      },
      required: allowPropose
        ? ["category", "summary", "tags", "confidence_score", "fit_score"]
        : ["category", "summary", "tags", "confidence_score"],
      additionalProperties: false,
    },
  };
  const tools = [listCategoriesTool(), searchSimilarTool(), fileExisting];
  if (!allowPropose) return tools;
  tools.unshift(listRecentFilingsTool());
  tools.push({
    name: PROPOSE_CHILD,
    description:
      "Finish by proposing exactly one new child under the closest existing category when that category is too broad. Call this once, and not together with file_existing.",
    inputSchema: {
      type: "object",
      properties: {
        parent: { type: "string" },
        name: { type: "string" },
        definition: { type: "string" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        confidence_score: { type: "number" },
        fit_score: { type: "number" },
      },
      required: [
        "parent",
        "name",
        "definition",
        "summary",
        "tags",
        "confidence_score",
        "fit_score",
      ],
      additionalProperties: false,
    },
  });
  return tools;
}

function listCategoriesTool(): ToolDefinition {
  return {
    name: LIST_CATEGORIES,
    description:
      "List the live taxonomy. Omit parent_id to list the whole tree. Pass parent_id to list that category and its direct children.",
    inputSchema: {
      type: "object",
      properties: { parent_id: { type: "string" } },
      additionalProperties: false,
    },
  };
}

function listRecentFilingsTool(): ToolDefinition {
  return {
    name: LIST_RECENT_FILINGS,
    description:
      "List the latest filed notes: path, category, summary, and time. Takes no arguments. Call this first. A recent streak does not decide the category.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  };
}

function searchSimilarTool(): ToolDefinition {
  return {
    name: SEARCH_SIMILAR_NOTES,
    description:
      "List already-filed notes that resemble the note being organized. Takes no arguments. Call this when the category fit is unclear.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  };
}

async function executeTool<T>(
  name: string,
  input: unknown,
  request: PlaceNoteRequest<T>,
  current: () => { value: T } | undefined,
  record: (value: T) => void,
): Promise<ToolOutcome> {
  try {
    if (current()) {
      return {
        content: "A placement was already recorded for this note.",
        isError: true,
      };
    }
    if (name === LIST_CATEGORIES) {
      return { content: renderCategories(request.entries, parentId(input)) };
    }
    if (name === LIST_RECENT_FILINGS) {
      assertNoArguments(input, LIST_RECENT_FILINGS);
      const recent = request.listRecent ? await request.listRecent() : [];
      return { content: renderRecent(recent) };
    }
    if (name === SEARCH_SIMILAR_NOTES) {
      assertNoArguments(input, SEARCH_SIMILAR_NOTES);
      return { content: renderSimilar(await request.searchSimilar()) };
    }
    if (name === FILE_EXISTING) {
      record(request.acceptExisting(input));
      return { content: "Placement recorded.", terminal: true };
    }
    if (name === PROPOSE_CHILD) {
      if (!request.allowPropose || !request.acceptPropose) {
        return { content: "propose_child is not available.", isError: true };
      }
      record(request.acceptPropose(input));
      return { content: "Placement recorded.", terminal: true };
    }
    return { content: `Unknown tool ${name}.`, isError: true };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

function parentId(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const record = toolRecord(input);
  const keys = Object.keys(record);
  if (keys.length === 0) return undefined;
  if (keys.length !== 1 || keys[0] !== "parent_id") {
    throw new Error("list_categories only accepts parent_id");
  }
  const value = record.parent_id;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("parent_id must be a category id");
  }
  return value.trim();
}

function assertNoArguments(input: unknown, tool: string): void {
  if (input === undefined || input === null) return;
  const record = toolRecord(input);
  if (Object.keys(record).length > 0) {
    throw new Error(`${tool} takes no arguments`);
  }
}

function renderCategories(
  entries: TaxonomyEntry[],
  parentIdValue: string | undefined,
): string {
  if (!parentIdValue) {
    return formatTaxonomy(entries) || "No categories are available.";
  }
  const parent = entries.find((entry) => entry.id === parentIdValue);
  if (!parent) throw new Error(`unknown category ${parentIdValue}`);
  const children = entries.filter((entry) => entry.parentId === parentIdValue);
  const lines = [formatLine(parent, 0)];
  if (children.length === 0) lines.push("  (no children)");
  else lines.push(...children.map((child) => formatLine(child, 1)));
  return lines.join("\n");
}

function formatTaxonomy(entries: TaxonomyEntry[]): string {
  const byParent = new Map<string | null, TaxonomyEntry[]>();
  for (const entry of entries) {
    const group = byParent.get(entry.parentId) ?? [];
    group.push(entry);
    byParent.set(entry.parentId, group);
  }
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const entry of byParent.get(parent) ?? []) {
      lines.push(formatLine(entry, depth));
      walk(entry.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}

function formatLine(entry: TaxonomyEntry, depth: number): string {
  return `${"  ".repeat(depth)}- ${entry.id} (${entry.name}): ${entry.definition}`;
}

function renderRecent(notes: RecentFiling[]): string {
  if (notes.length === 0) return "No notes have been filed yet.";
  return notes
    .map(
      (note) =>
        `- Filed: ${note.filedAt}\n  Path: ${note.path}\n  Category: ${note.categoryId}\n  Summary: ${note.summary}`,
    )
    .join("\n\n");
}

function renderSimilar(notes: SimilarNote[]): string {
  if (notes.length === 0) return "No similar notes are filed yet.";
  return notes
    .map(
      (note) =>
        `- Path: ${note.path}\n  Category: ${note.categoryId}\n  Summary: ${note.summary}\n  Excerpt: ${note.snippet}`,
    )
    .join("\n\n");
}
