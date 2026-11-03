# Stage 2 — Private hosted application and access

Status: In progress; the Cloudflare-native target and migration boundary are described in [02-cloudflare-native.md](02-cloudflare-native.md). Depends on [Stage 1](01-foundation-and-ui.md). Next: [Stage 3](03-github-connections-and-sync.md).

## Outcome

The user opens a real HTTPS URL, signs in and uses the manager without starting a server. Private staging exists early. The deployed process survives browser closure and host process restart; only the configured owner can access state or issue commands.

## Implementation slices

| Ticket | Owned paths, proposed unless existing | Deliverable and dependency |
| --- | --- | --- |
| PM-201: Owner authentication | `studio/auth.ts`, `app/api/auth/[...nextauth]/route.ts`, manager route/layout guards | GitHub sign-in, immutable owner-ID allowlist, sign-out/session expiry and authenticated reads/mutations. Check maintained compatible Auth.js version and pin it. |
| PM-202: Same-origin service boundary | `studio/app/api/manager/[...path]/route.ts`, `lib/manager-server.ts`, existing `lib/project-trpc.tsx`; manager `src/server/auth.ts` | Allowlisted typed forwarding to configured private manager origin, service authentication and verified actor context. Do not forward arbitrary target URLs, client-supplied identity headers or provider tokens. Depends on PM-201. |
| PM-203: Hosted setup/health UI | `studio/app/manager/settings/`, `components/manager/{setup,health}.tsx`; existing manager `src/server/main.ts` and health/config-status routes | Setup checklist, server-config status, model availability, data volumes and integration placeholders; friendly errors/retry. Separate HTTP/bootstrap health from provider readiness so missing model/library config does not prevent setup access. Never return secret values. Depends on PM-202. |
| PM-204: Deployable images and storage | `project-manager/deploy/`, image build definitions, scoped CI workflow | Root-context builds for local package dependencies, one manager replica, internal classifier/manager networking, HTTPS proxy, mounted data, backups, health/readiness, graceful drain and image rollback. |
| PM-205: Private staging release | Deployment configuration and `deploy/README.md` | Choose host/domain/region/budget, provision through authorized account, supply server secrets, deploy from CI, verify browser journeys and restore drill. Depends on PM-203/204. |

The persistent Linux-host deployment assumptions below are superseded by the Cloudflare-native direction; the security and acceptance requirements continue to apply.

## Hosting contract

Public ingress reaches only the HTTPS web entry and narrowly authenticated future callbacks. Next.js checks sessions at server routes/actions; hiding a button or redirecting navigation is insufficient authorization. Manager/classifier ports are internal, with explicit container bind addresses and service authentication. Preserve localhost development support. Exclude unrelated agent administration from the hosted app.

Private messages and operational data use `private/no-store` responses; no shared cache of sessions or state. Model/API credentials, owner Projects token and App key remain server-side; no `NEXT_PUBLIC_` secrets. If streaming is introduced, verify end-to-end proxy behavior; bounded polling is sufficient initially.

GitHub sign-in proves the user identity; it grants no implicit Projects/App integration authority. Initial infrastructure/model/App bootstrap secrets may be supplied by the implementer through the hosting console. Routine reconnection, capability checks, pause and retry must be browser actions in later stages. The deployment itself is implemented here, not executed by this planning task.

The current manager initializes its required library/model before listening. Refactor bootstrap so an authenticated owner can reach setup/health when model/library/provider configuration is absent or invalid; show those capabilities as unavailable and prevent related jobs. Do not instantiate a failing provider merely to serve configuration status. Mandatory login/session secrets and data-access controls must still be provisioned securely before private app access; degraded setup never means unauthenticated configuration or arbitrary filesystem editing.

## Browser acceptance

From a device without a local checkout: open the hosted URL, sign in, navigate the manager and inspect an existing source. Sign out and confirm protected API/HTML cannot be read. Another GitHub identity cannot access the application. Refresh an expired session and return to the prior page without duplicating a mutation. A stopped backend produces a readable service state rather than a browser localhost error.

## Verification and exit gate

- Authentication/authorization, forged actor context, CSRF/origin and unauthenticated direct API tests pass.
- Browser network requests never point at the user's loopback address. Secrets and raw exceptions do not appear in client bundles, traces or screenshots.
- A clean production image builds with independent package lockfiles and required sibling packages.
- Restart the manager, restore a backup into isolated staging, and verify notes/decisions/jobs. Demonstrate single-owner startup and rollback procedure.
- Start with missing/invalid model/library/provider settings and verify owner-authenticated setup/health remains reachable while affected actions are disabled and no jobs execute.
- Record target URL, release SHA, credential owners, backup/restore evidence and actual recovery timings.

Exit: owner-only private staging is usable entirely through a browser. Missing integrations are explicit and disabled; public availability is not confused with autonomous readiness. Rollback: promote the prior image and apply the migration's compatible restore procedure; never start old/new DB owners simultaneously.
