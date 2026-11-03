import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import {
  hasDuplicateSecurityHeaders,
  parseHostedConfig,
  verifyServiceRequest,
} from "./auth.ts";

const token = "test-only-service-token-1234567890";
const hosted = {
  MANAGER_HOSTED: "true",
  MANAGER_SERVICE_TOKEN: token,
  MANAGER_OWNER_ID: "16949569",
};
const config = { token, ownerId: "16949569", bindHost: "127.0.0.1" };
const authorized: IncomingHttpHeaders = {
  authorization: `Bearer ${token}`,
  "x-manager-actor": "16949569",
};

describe("hosted service configuration", () => {
  it("retains local mode and validates a complete hosted configuration", () => {
    expect(parseHostedConfig({})).toBeNull();
    expect(parseHostedConfig({ MANAGER_HOSTED: "false" })).toBeNull();
    expect(parseHostedConfig(hosted)).toEqual(config);
    expect(
      parseHostedConfig({ ...hosted, MANAGER_BIND_HOST: "0.0.0.0" }),
    ).toEqual({
      ...config,
      bindHost: "0.0.0.0",
    });
  });

  it("requires explicit hosted mode and valid service credentials in production", () => {
    for (const flag of [undefined, "false", "", "TRUE", "yes", "1"]) {
      expect(() =>
        parseHostedConfig({
          ...hosted,
          NODE_ENV: "production",
          MANAGER_HOSTED: flag,
        }),
      ).toThrow(
        "Hosted manager mode must be explicitly configured in production.",
      );
    }
    expect(() =>
      parseHostedConfig({ NODE_ENV: "production", MANAGER_HOSTED: "true" }),
    ).toThrow("Hosted manager service authentication is not configured.");
    expect(parseHostedConfig({ ...hosted, NODE_ENV: "production" })).toEqual(
      config,
    );
  });

  it("rejects malformed hosted mode flags instead of silently selecting local mode", () => {
    for (const flag of ["", "TRUE", "False", "yes", "1", " true", "true "]) {
      expect(() =>
        parseHostedConfig({ ...hosted, MANAGER_HOSTED: flag }),
      ).toThrow();
    }
  });

  it("rejects missing, short, whitespace, and non-ASCII service secrets without disclosing them", () => {
    for (const invalid of ["", "short", " ".repeat(32), `${token} é`]) {
      expect(() =>
        parseHostedConfig({ ...hosted, MANAGER_SERVICE_TOKEN: invalid }),
      ).toThrow("Hosted manager service authentication is not configured.");
      try {
        parseHostedConfig({ ...hosted, MANAGER_SERVICE_TOKEN: invalid });
      } catch (error) {
        if (invalid) expect(String(error)).not.toContain(invalid);
      }
    }
    expect(() =>
      parseHostedConfig({ ...hosted, MANAGER_SERVICE_TOKEN: undefined }),
    ).toThrow();
  });

  it("rejects invalid owner IDs and unexpected listening addresses", () => {
    for (const owner of [undefined, "", "0", "-1", "01", "123a", " 123"]) {
      expect(() =>
        parseHostedConfig({ ...hosted, MANAGER_OWNER_ID: owner }),
      ).toThrow();
    }
    for (const address of ["", "localhost", "::", "192.0.2.1"]) {
      expect(() =>
        parseHostedConfig({ ...hosted, MANAGER_BIND_HOST: address }),
      ).toThrow();
    }
  });
});

describe("hosted service request authentication", () => {
  it("accepts the exact trusted service token and owner identity", () => {
    expect(verifyServiceRequest(authorized, config)).toBe(true);
  });

  it("rejects missing, incorrect, or ambiguous credentials", () => {
    const invalid: IncomingHttpHeaders[] = [
      {},
      { ...authorized, authorization: undefined },
      { ...authorized, authorization: `bearer ${token}` },
      { ...authorized, authorization: `Bearer ${token}x` },
      { ...authorized, authorization: `Bearer ${"x".repeat(token.length)}` },
      {
        ...authorized,
        authorization: [`Bearer ${token}`, `Bearer ${token}`] as never,
      },
      { ...authorized, "x-manager-actor": undefined },
      { ...authorized, "x-manager-actor": "other" },
      { ...authorized, "x-manager-actor": ["16949569", "16949569"] },
    ];
    for (const headers of invalid)
      expect(verifyServiceRequest(headers, config)).toBe(false);
  });

  it("rejects browser-origin requests even with correct service credentials", () => {
    for (const origin of ["", "https://app.example", "null"]) {
      expect(verifyServiceRequest({ ...authorized, origin }, config)).toBe(
        false,
      );
    }
  });
});

describe("raw service security headers", () => {
  it("accepts exactly one authorization and actor header", () => {
    expect(
      hasDuplicateSecurityHeaders({
        authorization: [`Bearer ${token}`],
        "x-manager-actor": ["16949569"],
      }),
    ).toBe(false);
  });

  it("rejects repeated authorization, actor and origin headers before normalization", () => {
    const cases = [
      {
        authorization: [`Bearer ${token}`, `Bearer ${token}`],
        "x-manager-actor": ["16949569"],
      },
      {
        authorization: [`Bearer ${token}`],
        "x-manager-actor": ["16949569", "16949569"],
      },
      {
        authorization: [`Bearer ${token}`],
        "x-manager-actor": ["16949569"],
        origin: ["https://a", "https://b"],
      },
    ];
    for (const headers of cases)
      expect(hasDuplicateSecurityHeaders(headers)).toBe(true);
  });

  it("leaves missing credentials to the request authorization check", () => {
    expect(hasDuplicateSecurityHeaders({})).toBe(false);
    expect(verifyServiceRequest({}, config)).toBe(false);
  });
});
