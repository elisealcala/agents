# Building the agent

This package is a worked example of one Claude agent that files a Markdown note. The caller is ordinary code and always runs the same sequence. The agent is the classify step.

The steps below follow Claude's tool-use guide and the Agent SDK hook contract:

- [Implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- [Intercept agent behavior with hooks](https://code.claude.com/docs/en/agent-sdk/hooks)

The hook events are the ones in that second document. This package runs them inside its own Anthropic tool loop, because the agent files notes into a library and does not open a Claude Code session.

## 1. Choose the model

Claude is the only provider. `INGEST_MODEL` and `ANTHROPIC_API_KEY` are required. `createModelClient` in `src/providers/create-client.ts` builds the client, and `src/providers/anthropic.ts` calls `messages.create`.

A grounded answer is one system prompt plus one user message. Organizing a note is a tool loop. Those are the two calls on `ModelClient`.

## 2. Write the system prompt

The system prompt is the agent's instructions. The note is the user message. The taxonomy is not copied into the prompt; the agent loads it with a tool.

`DEFAULT_ADAPTIVE_ORGANIZER_TEMPLATE` in `src/classification/organizer.ts` tells the agent to:

1. Call `list_recent_filings` first. Recent notes show current habits.
2. Call `search_similar_notes`. Those notes show where this one belongs. They win when they disagree with the recent streak. Human corrections in the prompt win over both.
3. Call `list_categories` when it needs the tree or one category's children.
4. Finish with exactly one of `file_existing` or `propose_child`.

`file_existing` is the best category that already fits the note as a whole. `propose_child` is one new child under the closest parent when nothing that specific exists. The agent chooses that parent. It does not open a new top-level category.

## 3. Define the tools

Each tool is a name, a description, and a JSON schema, which is the shape from the tool-use guide. `organizerTools` in `src/classification/organizer.ts` builds them.

| Tool | Role |
|---|---|
| `list_recent_filings` | The latest filed notes: path, category, summary, and time. No arguments. |
| `search_similar_notes` | Notes that resemble this one. No arguments, so the agent cannot wander off the note. |
| `list_categories` | The live tree, or one category and its children when `parent_id` is set. |
| `file_existing` | Terminal. File into an existing category. |
| `propose_child` | Terminal. Propose one child under a parent the agent chooses. |

The handlers read SQLite and return text. They do not move the file.

## 4. Run the loop

`runToolLoop` in `src/providers/anthropic.ts` is the agent loop from the tool-use guide:

1. Send the system prompt, the note, and the tools.
2. While the stop reason is `tool_use`, run each tool and append the result.
3. Stop when a terminal tool succeeds, or when the turn cap is reached.

A fresh attempt does not keep the previous attempt's messages.

## 5. Register a PreToolUse hook

The adaptive classifier is not a second agent. It is a `PreToolUse` hook, which is the documented place to accept or reject a tool call before the handler runs.

`adaptivePlacementHooks` in `src/classification/adaptive-classifier.ts` registers one matcher, `file_existing|propose_child`. Lookup tools are not matched, so they always run.

The callback does what the hook guide shows:

- Return `{}` to allow the tool. The handler then records the placement.
- Return `permissionDecision: "deny"` and `permissionDecisionReason` to block it. The reason is the tool error the model sees, and the handler does not run.

The reason is the same rule the classifier has always enforced: the category must exist, scores must be between 0 and 1, and an existing match needs `fit_score` above `0.80`. A child proposal may also score above `0.80` when the parent fits but is too broad.

`runPreToolUse` in `src/agent/hooks.ts` applies matchers and stops at the first deny.

## 6. File the note in code

After the hook allows a placement, the pipeline takes over. It merges a proposed child into a sibling when the two mean the same thing, creates the folder, moves the file, and writes the audit row. The agent does not do those steps, so a denied placement never moves a file, and two notes that propose the same child still produce one folder.
