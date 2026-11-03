# Stage 2 OAuth and secret setup evidence

Status: **secret names configured**, 2026-11-03 (America/Lima). The project-manager application has not been deployed.

## Verified source configuration

- The Studio Wrangler config uses canonical origin `https://project-manager.ezth.workers.dev`; the intended GitHub OAuth callback is `https://project-manager.ezth.workers.dev/api/auth/callback/github`. The owner reports the GitHub OAuth app exists and confirmed both registered URLs match these values; the settings have not been independently inspected.
- Source validators require an owner ID, canonical HTTPS origin, a server-only `AUTH_SECRET` and GitHub client credentials. Service and migration tokens must each be at least 32 printable non-space ASCII characters and must differ. Sign-in grants no GitHub App or Projects authorization.
- Focused local checks: 20 manager authorization/migration tests and 20 Studio proxy/migration tests passed. These use synthetic credentials; they do not prove real OAuth or hosted configuration.

## Provider readiness

- After the owner explicitly authorized creation, Wrangler created placeholder Workers `project-manager` and `agents-manager-storage-staging` while provisioning secrets. Secret-list readback confirmed `AUTH_SECRET`, `MANAGER_SERVICE_TOKEN`, and `MANAGER_MIGRATION_TOKEN` on the web Worker, and both manager tokens on the storage Worker. The paired tokens were generated once and supplied to both Workers; the two tokens are distinct. These placeholders are not the application deployment.
- Expected web Worker secrets: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `MANAGER_SERVICE_TOKEN`, `MANAGER_MIGRATION_TOKEN`. Expected storage Worker secrets: `MANAGER_SERVICE_TOKEN`, `MANAGER_MIGRATION_TOKEN`; matching values must be provisioned securely for the two Workers, with service and migration tokens distinct. Values must never be placed in this file, Git, terminal output, screenshots or chat.
- The owner reports the GitHub OAuth app exists and confirmed its homepage and callback match the source configuration; ownership and credentials have not been independently inspected. The GitHub plugin connection is separate from application sign-in. The owner provisioned `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` directly; Wrangler secret-list readback confirmed both names on the web Worker. Secret-list verifies presence, not correctness of values. The OAuth app URLs are owner-confirmed, not independently inspected.

Real sign-in, owner/non-owner access and session expiry are later deployment acceptance work. Stage 2 #22 remains open.

- An initial attempt was rejected by automatic approval review. The owner subsequently explicitly authorized creating the placeholders and provisioning the generated secrets; the subsequent action succeeded.
