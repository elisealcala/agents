/** Delivery data is distinct from reviewed note facts and untrusted GitHub text. */
import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const revision = z.number().int().nonnegative();
const timestamp = z.iso.datetime();

/** The provider's stable repository ID is authoritative; names are display data. */
export const repositoryIdentitySchema = z.strictObject({
  provider: z.literal("github"),
  repositoryId: id,
  owner: id,
  name: id,
});
export type RepositoryIdentity = z.infer<typeof repositoryIdentitySchema>;

export const workIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  issueNumber: z.number().int().positive(),
});
export type WorkIdentity = z.infer<typeof workIdentitySchema>;

const githubObservationSchema = z.strictObject({
  kind: z.literal("github_observation"),
  sourceUrl: z.url(),
  observedAt: timestamp,
});
const humanDecisionSchema = z.strictObject({
  kind: z.literal("human_decision"),
  actorId: id,
  conversationTurnId: id,
});
export const provenanceSchema = z.discriminatedUnion("kind", [
  githubObservationSchema,
  humanDecisionSchema,
  z.strictObject({ kind: z.literal("planner_proposal"), proposalId: id }),
  z.strictObject({
    kind: z.literal("approved_note_fact"),
    projectId: id,
    factId: id,
  }),
]);
export type Provenance = z.infer<typeof provenanceSchema>;

export const capabilityStateSchema = z.enum([
  "unconfigured",
  "available",
  "degraded",
  "paused",
  "disabled",
]);
export type CapabilityState = z.infer<typeof capabilityStateSchema>;

export const qaFingerprintSchema = z.strictObject({
  repository: repositoryIdentitySchema,
  pullRequestNumber: z.number().int().positive(),
  headSha: id,
  baseSha: id,
  criteriaRevision: id,
  linkedIssues: z.array(workIdentitySchema).min(1),
  planRevision: id,
  policyRevision: id,
  environmentRevision: id,
});
export type QaFingerprint = z.infer<typeof qaFingerprintSchema>;

export const workItemSchema = z.strictObject({
  identity: workIdentitySchema,
  revision,
  status: z.enum([
    "proposed",
    "ready",
    "in_progress",
    "in_review",
    "done",
    "cancelled",
    "closed_unverified",
  ]),
  provenance: provenanceSchema,
});
export const decisionSchema = z.strictObject({
  id,
  repository: repositoryIdentitySchema,
  revision,
  provenance: humanDecisionSchema,
  kind: id,
  value: id,
});
export const observationSchema = z.strictObject({
  id,
  repository: repositoryIdentitySchema,
  revision,
  provenance: githubObservationSchema,
});
export const jobSchema = z.strictObject({
  id,
  repository: repositoryIdentitySchema,
  kind: id,
  revision,
  status: z.enum(["queued", "running", "reconciling", "completed", "failed"]),
  attemptId: id.nullable(),
  leaseExpiresAt: timestamp.nullable(),
});
export const outboxIntentSchema = z.strictObject({
  id,
  repository: repositoryIdentitySchema,
  operationKey: id,
  kind: id,
  revision,
  status: z.enum(["queued", "dispatching", "confirmed", "unknown", "failed"]),
  attemptId: id.nullable(),
  leaseExpiresAt: timestamp.nullable(),
});
/** A report summary only; never use this shape as a passing QA or merge gate. */
export const qaReportSchema = z.strictObject({
  id,
  fingerprint: qaFingerprintSchema,
  verdict: z.enum(["pass", "changes_requested", "inconclusive"]),
});
export const notificationSchema = z.strictObject({
  id,
  repository: repositoryIdentitySchema,
  reason: id,
  fingerprint: id,
  status: z.enum([
    "queued",
    "provider_confirmed",
    "user_acknowledged",
    "resolved",
  ]),
});

/** A contribution is evidence for criteria, not a ticket-completion verdict. */
export const contributionSchema = z.strictObject({
  id,
  work: workIdentitySchema,
  pullRequestNumber: z.number().int().positive(),
  headSha: id,
  coveredCriteria: z.array(id).min(1),
  provenance: z.union([
    githubObservationSchema,
    z.strictObject({
      kind: z.literal("approved_note_fact"),
      projectId: id,
      factId: id,
    }),
  ]),
});
