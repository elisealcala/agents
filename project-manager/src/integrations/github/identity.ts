import type { GitHubAppClient, GitHubPermissionLevel, GitHubRepositoryInfo } from "./client";

/** Expected stable identity of a repository (numeric IDs, not names). */
export interface ExpectedRepository {
  repositoryId: number;
  fullName: string;
}

export interface ExpectedIdentity {
  installationId: number;
  accountId: number;
  repositories: readonly ExpectedRepository[];
  requiredPermissions: Readonly<Record<string, GitHubPermissionLevel>>;
}

export type RepositoryCapabilityDenial =
  | "repository_not_accessible"
  | "repository_identity_mismatch";

export type RepositoryCapability =
  | { repositoryId: number; fullName: string; status: "available" }
  | { repositoryId: number; fullName: string; status: "denied"; reason: RepositoryCapabilityDenial };

export type InstallationCapabilityResult =
  | { ok: true; installationId: number; accountId: number; repositories: readonly RepositoryCapability[] }
  | {
      ok: false;
      reason:
        | "credentials_expired"
        | "installation_not_found"
        | "account_mismatch"
        | "missing_permissions"
        | "access_denied"
        | "unavailable";
      missingPermissions?: readonly string[];
    };

const LEVELS: Record<GitHubPermissionLevel, number> = { read: 1, write: 2, admin: 3 };

/** Verifies installation account, permissions and repository identities. Results never contain credentials. */
export async function checkInstallationCapabilities(
  client: GitHubAppClient,
  expected: ExpectedIdentity,
): Promise<InstallationCapabilityResult> {
  const installation = await client.getInstallation(expected.installationId);
  if (!installation.ok) {
    return {
      ok: false,
      reason: installation.reason === "not_found" ? "installation_not_found" : installation.reason,
    };
  }
  const info = installation.value;
  if (info.installationId !== expected.installationId || info.accountId !== expected.accountId) {
    return { ok: false, reason: "account_mismatch" };
  }

  const missing = Object.entries(expected.requiredPermissions)
    .filter(([name, level]) => {
      const granted = info.permissions[name];
      return granted === undefined || LEVELS[granted] < LEVELS[level];
    })
    .map(([name]) => name);
  if (missing.length > 0) {
    return { ok: false, reason: "missing_permissions", missingPermissions: missing };
  }

  const listed = await client.listRepositories(expected.installationId);
  if (!listed.ok) {
    return { ok: false, reason: listed.reason === "not_found" ? "installation_not_found" : listed.reason };
  }
  const byId = new Map<number, GitHubRepositoryInfo>(listed.value.map((r) => [r.repositoryId, r]));

  const repositories = expected.repositories.map((repo): RepositoryCapability => {
    const found = byId.get(repo.repositoryId);
    if (!found) {
      return {
        repositoryId: repo.repositoryId,
        fullName: repo.fullName,
        status: "denied",
        reason: "repository_not_accessible",
      };
    }
    if (
      found.ownerId !== expected.accountId ||
      found.fullName.toLowerCase() !== repo.fullName.toLowerCase()
    ) {
      return {
        repositoryId: repo.repositoryId,
        fullName: repo.fullName,
        status: "denied",
        reason: "repository_identity_mismatch",
      };
    }
    return { repositoryId: repo.repositoryId, fullName: found.fullName, status: "available" };
  });

  return { ok: true, installationId: info.installationId, accountId: info.accountId, repositories };
}
