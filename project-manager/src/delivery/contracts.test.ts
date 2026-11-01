import { describe, expect, it } from "vitest";
import {
  capabilityStateSchema,
  contributionSchema,
  provenanceSchema,
  qaFingerprintSchema,
  repositoryIdentitySchema,
  workIdentitySchema,
} from "./contracts.ts";

const repository = {
  provider: "github",
  repositoryId: "R_123",
  owner: "example",
  name: "project",
};
const issue = { repository, issueNumber: 21 };
const fingerprint = {
  repository,
  pullRequestNumber: 42,
  headSha: "head",
  baseSha: "base",
  criteriaRevision: "criteria-1",
  linkedIssues: [issue],
  planRevision: "plan-1",
  policyRevision: "policy-1",
  environmentRevision: "environment-1",
};

describe("delivery contracts", () => {
  it("requires a stable repository identity and scopes every issue to it", () => {
    expect(repositoryIdentitySchema.parse(repository)).toEqual(repository);
    expect(workIdentitySchema.parse(issue)).toEqual(issue);
    expect(
      repositoryIdentitySchema.safeParse({ ...repository, repositoryId: " " })
        .success,
    ).toBe(false);
    expect(workIdentitySchema.safeParse({ issueNumber: 21 }).success).toBe(
      false,
    );
    expect(
      workIdentitySchema.safeParse({ ...issue, issueNumber: 0 }).success,
    ).toBe(false);
    expect(
      workIdentitySchema.safeParse({ ...issue, unexpected: true }).success,
    ).toBe(false);
  });

  it("keeps observations, decisions, proposals and approved facts in distinct provenance lanes", () => {
    const examples = [
      {
        kind: "github_observation",
        sourceUrl: "https://github.com/example/project/issues/21",
        observedAt: "2026-11-01T00:00:00Z",
      },
      {
        kind: "human_decision",
        actorId: "owner",
        conversationTurnId: "turn-1",
      },
      { kind: "planner_proposal", proposalId: "proposal-1" },
      { kind: "approved_note_fact", projectId: "project-1", factId: "fact-1" },
    ];
    for (const example of examples)
      expect(provenanceSchema.parse(example)).toEqual(example);
    expect(
      provenanceSchema.safeParse({
        kind: "human_decision",
        proposalId: "proposal-1",
      }).success,
    ).toBe(false);
    expect(
      provenanceSchema.safeParse({ ...examples[2], actorId: "owner" }).success,
    ).toBe(false);
    expect(
      provenanceSchema.safeParse({ ...examples[0], observedAt: "yesterday" })
        .success,
    ).toBe(false);
    expect(provenanceSchema.safeParse({ kind: "unknown" }).success).toBe(false);
  });

  it("recognizes only the documented capability states", () => {
    for (const state of [
      "unconfigured",
      "available",
      "degraded",
      "paused",
      "disabled",
    ]) {
      expect(capabilityStateSchema.parse(state)).toBe(state);
    }
    expect(capabilityStateSchema.safeParse("ready").success).toBe(false);
  });

  it("requires every version binding and at least one scoped issue for QA", () => {
    expect(qaFingerprintSchema.parse(fingerprint)).toEqual(fingerprint);
    for (const key of Object.keys(fingerprint)) {
      const incomplete = { ...fingerprint } as Record<string, unknown>;
      delete incomplete[key];
      expect(qaFingerprintSchema.safeParse(incomplete).success, key).toBe(
        false,
      );
    }
    expect(
      qaFingerprintSchema.safeParse({ ...fingerprint, linkedIssues: [] })
        .success,
    ).toBe(false);
    expect(
      qaFingerprintSchema.safeParse({ ...fingerprint, headSha: "" }).success,
    ).toBe(false);
    expect(
      qaFingerprintSchema.safeParse({ ...fingerprint, pullRequestNumber: -1 })
        .success,
    ).toBe(false);
  });

  it("requires scoped criterion evidence for a contribution without claiming ticket completion", () => {
    const contribution = {
      id: "contribution-1",
      work: issue,
      pullRequestNumber: 42,
      headSha: "abc123",
      coveredCriteria: ["criterion-1"],
      provenance: {
        kind: "github_observation",
        sourceUrl: "https://github.com/example/project/pull/42",
        observedAt: "2026-11-01T00:00:00Z",
      },
    };
    expect(contributionSchema.parse(contribution)).toEqual(contribution);
    expect(
      contributionSchema.safeParse({
        ...contribution,
        provenance: {
          kind: "approved_note_fact",
          projectId: "p1",
          factId: "f1",
        },
      }).success,
    ).toBe(true);
    for (const key of Object.keys(contribution)) {
      const incomplete = { ...contribution } as Record<string, unknown>;
      delete incomplete[key];
      expect(contributionSchema.safeParse(incomplete).success, key).toBe(false);
    }
    expect(
      contributionSchema.safeParse({
        ...contribution,
        work: { issueNumber: 21 },
      }).success,
    ).toBe(false);
    expect(
      contributionSchema.safeParse({ ...contribution, coveredCriteria: [] })
        .success,
    ).toBe(false);
    expect(
      contributionSchema.safeParse({ ...contribution, coveredCriteria: [" "] })
        .success,
    ).toBe(false);
    expect(
      contributionSchema.safeParse({ ...contribution, headSha: "" }).success,
    ).toBe(false);
    expect(
      contributionSchema.safeParse({
        ...contribution,
        provenance: { kind: "planner_proposal", proposalId: "p1" },
      }).success,
    ).toBe(false);
    expect(
      contributionSchema.safeParse({
        ...contribution,
        provenance: {
          kind: "github_observation",
          sourceUrl: contribution.provenance.sourceUrl,
        },
      }).success,
    ).toBe(false);
    expect(
      contributionSchema.safeParse({ ...contribution, completed: true })
        .success,
    ).toBe(false);
  });
});
