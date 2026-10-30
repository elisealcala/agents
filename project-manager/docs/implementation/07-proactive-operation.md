# Stage 7 — Proactive attention and browser operations

Status: Planned. Depends on [Stages 2–6](README.md#stages-and-dependencies). Next: [Stage 8](08-production-pilot-and-release.md).

## Outcome

The manager reaches the user for useful blockers, decisions and ideas while the site is closed. Daily operation—including pause, retry, reconnect, acknowledgement and status inspection—takes place in the UI. Routine unchanged scans stay quiet.

## Implementation slices

| Ticket | Owned paths, proposed unless existing | Deliverable and dependency |
| --- | --- | --- |
| PM-701: Durable inbox and attention policy | `src/notifications/{inbox,policy}.ts`, `studio/app/manager/inbox/` | Material-transition deduplication, private decision/idea messages, choices, snooze, acknowledgement and resolution. |
| PM-702: Outbound delivery | `src/notifications/delivery.ts`, GitHub comment adapter/outbox | Bot coordination issue mentions, public-safe summaries, provider receipt/unknown-result reconciliation and browser test alert. Depends on PM-701. |
| PM-703: Operational controls | `src/operations/{health,budgets}.ts`, settings/activity UI | Connection recheck, retry failed eligible job, pause/resume, budgets, queue/lease/sync visibility and actionable recovery without shell commands. |
| PM-704: External health and alerting | Deployment monitor configuration and restricted notification credential | Heartbeat observation outside manager host, missed-heartbeat outage alert, restart/restore drill and recovered-state notice. Depends on earlier hosted stages. |
| PM-705: Quietness and delivery acceptance | Provider doubles, inbox/browser tests and actual channel test evidence | Failed delivery/retry/ack races, new versus unchanged blocker, deferred idea, model outage and browser/laptop-off exercise. |

## Notification contract

Use a stable key for recipient/repo/object/reason/material version. Persist inbox entry before sending. Differentiate queued, provider-confirmed, user-acknowledged and resolved; none implies the next. Suppress unchanged reminders unless an explicit reminder policy is due. Acknowledging in Studio cancels pending external attempts, including retries after earlier delivery failure.

Public repo comments never include private conversation, credentials or internal artifacts. Private content stays in Studio; the outbound summary contains only a public-safe attention link/message. Test actual user notification settings and receive acknowledgement before declaring proactive setup complete. A failed channel remains a visible setup/operations blocker; do not assume an unspecified fallback exists.

Infrastructure/model failures use bounded backoff and one actionable escalation, rather than repeated alerts. Group related QA findings. New ideas include evidence/value/rationale, stay proposed until selected and do not become committed work merely because they were generated.

## Browser acceptance

Close the website and put the laptop to sleep. From an independent test trigger, create a meaningful blocker/decision; receive the bot attention message, open the hosted inbox, choose a resolution and see progress resume. Repeat unchanged scans without further sends. Acknowledge an inbox item during a failed outbound attempt; verify retry stays suppressed. Rotate a revoked connection and retry a recoverable job from settings.

## Verification and exit gate

- Test actual delivery, acknowledgement and public/private boundary; a recorded API call alone is insufficient evidence of attention delivery.
- Confirm actual send attempts, not just unique stored records. Unknown remote comment results reconcile before a replacement send.
- Heartbeat detection works with the entire manager host stopped; its monitor does not depend on that host.
- Budgets/timeouts stop dispatch safely and expose the next user/operator action. Destructive data recovery remains an operator runbook, not an unsafe generic UI reset.

Exit: verified proactive contact and routine browser operation. Rollback: pause outbound delivery and automation, preserving durable inbox/ACK state and reconciling any accepted provider effects.
