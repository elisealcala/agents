/** Server-side GitHub App client. Transport is injected so tests use provider doubles. */

export type GitHubPermissionLevel = "read" | "write" | "admin";
export type GitHubPermissions = Readonly<Record<string, GitHubPermissionLevel>>;

export interface GitHubInstallationToken {
  token: string;
  /** ISO-8601 expiry. */
  expiresAt: string;
}

export interface GitHubInstallationInfo {
  installationId: number;
  accountId: number;
  accountLogin: string;
  permissions: GitHubPermissions;
}

export interface GitHubRepositoryInfo {
  repositoryId: number;
  fullName: string;
  ownerId: number;
  ownerLogin: string;
}

export type GitHubTransportErrorKind = "unauthorized" | "forbidden" | "not_found" | "unavailable";

export class GitHubTransportError extends Error {
  readonly kind: GitHubTransportErrorKind;
  constructor(kind: GitHubTransportErrorKind, message: string = kind) {
    super(message);
    this.name = "GitHubTransportError";
    this.kind = kind;
  }
}

/** Low-level provider boundary; implementations must not put credentials in error messages. */
export interface GitHubAppTransport {
  getInstallation(installationId: number): Promise<GitHubInstallationInfo>;
  createInstallationToken(installationId: number): Promise<GitHubInstallationToken>;
  listInstallationRepositories(token: string): Promise<readonly GitHubRepositoryInfo[]>;
}

export type GitHubClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "credentials_expired" | "access_denied" | "not_found" | "unavailable" };

export interface GitHubAppClientOptions {
  transport: GitHubAppTransport;
  now?: () => Date;
  /** Refresh tokens this close to expiry. */
  refreshSkewMs?: number;
}

export class GitHubAppClient {
  private readonly transport: GitHubAppTransport;
  private readonly now: () => Date;
  private readonly skewMs: number;
  private readonly tokens = new Map<number, GitHubInstallationToken>();

  constructor(options: GitHubAppClientOptions) {
    this.transport = options.transport;
    this.now = options.now ?? (() => new Date());
    this.skewMs = options.refreshSkewMs ?? 60_000;
  }

  private fresh(token: GitHubInstallationToken | undefined): token is GitHubInstallationToken {
    return token !== undefined && Date.parse(token.expiresAt) - this.skewMs > this.now().getTime();
  }

  private async run<T>(fn: () => Promise<T>): Promise<GitHubClientResult<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      if (error instanceof GitHubTransportError) {
        switch (error.kind) {
          case "unauthorized":
            return { ok: false, reason: "credentials_expired" };
          case "forbidden":
            return { ok: false, reason: "access_denied" };
          case "not_found":
            return { ok: false, reason: "not_found" };
          default:
            return { ok: false, reason: "unavailable" };
        }
      }
      return { ok: false, reason: "unavailable" };
    }
  }

  getInstallation(installationId: number): Promise<GitHubClientResult<GitHubInstallationInfo>> {
    return this.run(() => this.transport.getInstallation(installationId));
  }

  /** Lists repositories visible to the installation, refreshing an expired token once. */
  async listRepositories(installationId: number): Promise<GitHubClientResult<readonly GitHubRepositoryInfo[]>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let token = this.tokens.get(installationId);
      if (!this.fresh(token)) {
        const minted = await this.run(() => this.transport.createInstallationToken(installationId));
        if (!minted.ok) return minted;
        token = minted.value;
        this.tokens.set(installationId, token);
      }
      const bearer = token.token;
      const result = await this.run(() => this.transport.listInstallationRepositories(bearer));
      if (result.ok || result.reason !== "credentials_expired") return result;
      // Server rejected the cached token: drop it and retry once with a new one.
      this.tokens.delete(installationId);
    }
    return { ok: false, reason: "credentials_expired" };
  }
}
