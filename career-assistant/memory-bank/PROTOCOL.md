# Memory bank protocol

This folder is the **only** memory for the agent that owns it. Do not read or write another agent's `memory-bank/`.

Applies to Cursor, Claude Code, Codex, and any coding agent working in this agent folder.

## Files

| File | Role |
|---|---|
| `progress.md` | Status, checklist of pieces, append-only dated log |
| `decisions.md` | Registry of lasting decisions (`DEC-001`, `DEC-002`, …) |
| `active-context.md` | Current focus and next steps |
| `plans/` | One markdown file per work piece |

Root `AGENTS.md` / `CLAUDE.md` are protocol only. They are not a memory bank.

## Before any task

1. Confirm you are in the correct agent folder.
2. Read `progress.md`, `active-context.md`, and `decisions.md`.
3. Read a file in `plans/` only if this task is that piece.

## After every task

- [ ] Append a dated entry to `progress.md` (what changed, what is left)
- [ ] Update checklist/status in `progress.md`
- [ ] Refresh `active-context.md` (current focus + next steps)
- [ ] If a decision stuck, add `DEC-NNN` to `decisions.md`
- [ ] Tell the user the bank was updated

## Decisions

Use this shape in `decisions.md`:

```markdown
## DEC-NNN: Title
Date: YYYY-MM-DD
Status: accepted | superseded | rejected
Context: Why this came up
Decision: What we chose
Consequences: What this forces later
```

Do not bury decisions in `progress.md` or chat.
