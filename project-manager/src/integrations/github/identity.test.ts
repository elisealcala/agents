import { describe, expect, it } from "vitest";
import {
  GitHubAppClient,
  GitHubTransportError,
  type GitHubAppTransport,
  type GitHubInstallationInfo,
  type GitHubRepositoryInfo,
} from "./client";
import { checkInstallationCapabilities, type ExpectedIdentity } from "./identity";

const SECRET = "ghs_supersecret";
const NOW = new Date("2025-01-01T00:00:00Z");

const agents: GitHubRepositoryInfo = { repositoryId: 1, fullName: "acme/agents", ownerId: 10, ownerLogin: "acme" };
const design: GitHubRepositoryInfo = { repositoryId: 2, fullName: "acme/chore-design", ownerId: 10, ownerLogin: "acme" };

const installation: GitHubInstallationInfo = {
  installationId: 99,
  accountId: 10,
  accountLogin: "acme",
  permissions: { contents: "read", issues: "write" },
};

const expected: ExpectedIdentity = {
  installationId: 99,
  accountId: 10,
  repositories: [
    { repositoryId: 1, fullName: "acme/agents" },
    { repositoryId: 2, fullName: "acme/chore-design" },
  ],
  requiredPermissions: { contents: "read", issues: "read" },
};

function double(overrides: Partial<GitHubAppTransport> = {}) {
  const calls = { mint: 0, list: 0 };
  const transport: GitHubAppTransport = {
    getInstallation: async () => installation,
    createInstallationToken: async () => {
      calls.mint += 1;
      return { token: `${SECRET}_${calls.mint}`, expiresAt: "2025-01-01T01:00:00Z" };
    },
    listInstallationRepositories: async () => {
      calls.list += 1;
      return [agents, design];
    },
    ...overrides,
  };
  return { calls, client: new GitHubAppClient({ transport, now: () => NOW }) };
}

describe("checkInstallationCapabilities", () => {
  it("maps both repositories by stable id", async () => {
    const { client } = double();
    const result = await checkInstallationCapabilities(client, expected);
    expect(result).toEqual({
      ok: true,
      installationId: 99,
      accountId: 10,
      repositories: [
        { repositoryId: 1, fullName: "acme/agents", status: "available" },
        { repositoryId: 2, fullName: "acme/chore-design", status: "available" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("refreshes an expired installation token once", async () => {
    let first = true;
    const { client, calls } = double({
      listInstallationRepositories: async (token) => {
        if (first) {
          first = false;
          throw new GitHubTransportError("unauthorized", `bad ${token}`);
        }
        return [agents, design];
      },
    });
    const result = await checkInstallationCapabilities(client, expected);
    expect(result.ok).toBe(true);
    expect(calls.mint).toBe(2);
  });

  it("reports expired credentials when refresh keeps failing", async () => {
    const { client } = double({
      listInstallationRepositories: async (token) => {
        throw new GitHubTransportError("unauthorized", `bad ${token}`);
      },
    });
    const result = await checkInstallationCapabilities(client, expected);
    expect(result).toEqual({ ok: false, reason: "credentials_expired" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("denies a wrong account", async () => {
    const { client } = double({ getInstallation: async () => ({ ...installation, accountId: 11 }) });
    expect(await checkInstallationCapabilities(client, expected)).toEqual({ ok: false, reason: "account_mismatch" });
  });

  it("denies missing permissions", async () => {
    const { client } = double({
      getInstallation: async () => ({ ...installation, permissions: { contents: "read" } }),
    });
    expect(await checkInstallationCapabilities(client, expected)).toEqual({
      ok: false,
      reason: "missing_permissions",
      missingPermissions: ["issues"],
    });
  });

  it("denies inaccessible and renamed/wrong-owner repositories", async () => {
    const { client } = double({
      listInstallationRepositories: async () => [{ ...agents, ownerId: 77 }],
    });
    const result = await checkInstallationCapabilities(client, expected);
    expect(result).toMatchObject({
      ok: true,
      repositories: [
        { repositoryId: 1, status: "denied", reason: "repository_identity_mismatch" },
        { repositoryId: 2, status: "denied", reason: "repository_not_accessible" },
      ],
    });
  });

  it("maps provider forbidden to access_denied", async () => {
    const { client } = double({
      getInstallation: async () => {
        throw new GitHubTransportError("forbidden");
      },
    });
    expect(await checkInstallationCapabilities(client, expected)).toEqual({ ok: false, reason: "access_denied" });
  });
});
