# Active context — studio

## Current focus

The ask thread shows the classifier reply under the question, and the page uses Geist.

## Recent changes

- Wired `--font-sans` to the Geist font Next loads, instead of a variable that pointed at itself.
- The chat reads the finished `ask_question` span and refetches the run until it leaves `running`, then places the reply after the question.

## Next steps

1. Ask another question in the open studio and confirm the reply appears under it without reloading.
2. When the next TypeScript agent exists, add its router type and a workspace page. Keep the trace components shared.
