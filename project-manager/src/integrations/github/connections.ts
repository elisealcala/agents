/** Server-only GitHub connection contracts. Credentials never appear in views. */

export const connectionKinds = ["app", "projects"] as const;
export type ConnectionKind = (typeof connectionKinds)[number];

export const connectionStatuses = [
  "connected",
  "degraded",
  "disconnected",
] as const;
export type ConnectionStatus = (typeof connectionStatuses)[number];

export type ConnectionCapabilities = {
  repositoryRead: boolean;
  projectsRead: boolean;
  /** Later-stage capabilities stay disabled in this slice. */
  inventorySync: boolean;
  projectWrites: boolean;
};

export const disabledCapabilities: ConnectionCapabilities = {
  repositoryRead: false,
  projectsRead: false,
  inventorySync: false,
  projectWrites: false,
};

/** Credential-free view of a stored connection. */
export type ConnectionView = {
  id: string;
  kind: ConnectionKind;
  externalRef: string;
  status: ConnectionStatus;
  capabilities: ConnectionCapabilities;
  revision: number;
  hasCredential: boolean;
};

export type ConnectionReceipt = {
  seq: number;
  connectionId: string;
  action: "created" | "updated" | "rotated" | "disconnected";
  revision: number;
  at: string;
};

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

export function normalizeCapabilities(input: unknown): ConnectionCapabilities {
  const value = (input ?? {}) as Record<string, unknown>;
  const flag = (key: keyof ConnectionCapabilities) => value[key] === true;
  const result = {
    repositoryRead: flag("repositoryRead"),
    projectsRead: flag("projectsRead"),
    inventorySync: flag("inventorySync"),
    projectWrites: flag("projectWrites"),
  };
  if (result.inventorySync || result.projectWrites)
    throw new ConnectionError("Capability is not available yet");
  return result;
}
