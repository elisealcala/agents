# Stage 2 degraded setup evidence (GH-113)

Status: **partial, 2026-11-10.** The owner used the hosted site with no local manager or classifier process. Issue #113 stays open because the pre-import outage copy still tells the reader to check a local manager. Issue #22 stays open.

## What the owner could do

On `https://project-manager.ezth.workers.dev/manager`, after the cutover in [stage-2-cutover.md](stage-2-cutover.md):

- Setup showed Evidence `Configured`, and Model, Intake, and Conversation `Not configured`, with the sentence “Configuration status does not confirm the provider is reachable.” GitHub connection, QA, and automatic delivery were described as not enabled. A “Check again” control was present.
- `GET /api/manager/agent.configuration` returned 200 with `evidence: configured` and `model`, `intake`, and `conversation` set to `unconfigured`.
- The notes workspace loaded the imported project and its pending review list. No model, intake, or search action was turned on. No proposal was decided.

Before the import, the same signed-in page showed “Manager is unavailable.” and “Check that the local manager is running, then retry.” The API returned 503 `Manager is unavailable. Try again.` with `private, no-store`. That sentence is readable and has a retry control, and it is distinct from the setup page’s “Not configured” rows, but it still describes local process administration on the hosted site. No stack trace or secret name was shown.

Keyboard focus reached the section buttons. A second device and a non-owner session were not used.
