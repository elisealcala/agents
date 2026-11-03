# Stage 2 R2 setup evidence

Status: **bucket and retention configured; hosted backup and recovery remain unverified**, 2026-11-03 (America/Lima).

## Initial account check, 2026-11-02

- The selected Cloudflare account is the one configured for `ezth.workers.dev`. Wrangler identified the account, and its R2 bucket-list request returned Cloudflare error 10042: R2 must be enabled in the Dashboard. No bucket list was returned; this is not proof that the account contains no buckets.
- The R2 onboarding page shows Standard usage-based billing: $0 due now, 10 GB-month, 1 million Class A and 10 million Class B operations included monthly; excess usage is billed. It describes an automatically renewing subscription and acceptance of Cloudflare terms. The account owner must review and submit this step. Payment details and provider terms were not changed.
- The source configuration already names the intended `agents-manager-staging-backups` bucket and `BACKUPS` binding. **Neither bucket creation, access controls nor lifecycle policy is verified yet.** No credentials, user backup contents, object data, or payment information were recorded here.
- Account spending controls and notifications have not been verified. After activation, verify account identity and cost controls, check existing buckets before creating anything, and provision or inspect the intended private bucket. Verify no public endpoint or custom domain and the 30-day expiration applies only to `manager-backups/`; verify permissions and retain complete original local backups separately. Do not delete data for a retention test.

This is account setup evidence, not proof of hosted backups or Stage 2 acceptance. The application has not been deployed by this task. Issue #105 remains open.

## 2026-11-03 follow-up

- The owner reported completing setup. A new authenticated `wrangler r2 bucket list` returned successfully with no buckets listed, unlike the earlier activation error. This confirms R2 listing access but does not establish bucket creation, write permissions, public-access settings, lifecycle, spending limits or billing alerts.
- The planned storage/recovery architecture is diagrammed in `project-manager/docs/implementation/02-cloudflare-native.md`. At this point account cost controls were not yet confirmed; the later verification below records the owner’s answer and provisioning. No user data was uploaded.

## 2026-11-03 bucket verification

- The owner confirmed no account spending limit or billing alert is configured and explicitly chose to proceed with the Standard free allowance. Charges can apply above the included allowance.
- Created `agents-manager-staging-backups` in the selected account with Standard as the default storage class; bucket information reported location ENAM and initially zero objects. The existing manager configuration already binds this name as `BACKUPS`.
- Read back public access: the r2.dev URL is disabled and the custom-domain list is empty. The `manager-backup-30-days` lifecycle rule is enabled for `manager-backups/`, expiring objects after 30 days. Cloudflare also has its default seven-day abort rule for incomplete multipart uploads across all prefixes; that is not an object-expiration rule.
- The authenticated Wrangler identity created the bucket and rule and successfully wrote, read and deleted one newly generated synthetic object. This checks the operator's management and object access, not a deployed Worker's binding or access by other identities. No real backups were uploaded or deleted.
- The source and retained original local backups remain separate. Actual automatic backup, owner download, hosted permissions and isolated restore still require later Stage 2 validation.
