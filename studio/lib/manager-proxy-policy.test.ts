import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHostedMode, isLoginConfigured } from "./manager-mode.ts";
import {
  isAllowedOperation,
  isTrustedMutationOrigin,
} from "./manager-proxy-policy.ts";

const queries = [
  "agent.identity",
  "agent.configuration",
  "delivery.repositories",
  "delivery.work",
  "delivery.outbox",
  "projects.list",
  "projects.get",
  "reviews.list",
  "runs.list",
  "runs.get",
  "evidence.read",
  "evaluations.list",
  "evaluations.get",
];
const mutations = [
  "delivery.bindKnownRepository",
  "projects.create",
  "notes.submit",
  "notes.retry",
  "reviews.resolve",
  "conversations.send",
];

describe("manager proxy operation policy", () => {
  it("allows each known procedure and batches of the same method", () => {
    for (const query of queries)
      assert.equal(isAllowedOperation("GET", query), true, query);
    for (const mutation of mutations)
      assert.equal(isAllowedOperation("POST", mutation), true, mutation);
    assert.equal(isAllowedOperation("GET", queries.join(",")), true);
    assert.equal(isAllowedOperation("POST", mutations.join(",")), true);
  });

  it("rejects operations under the wrong method, mixed batches, and unsupported methods", () => {
    for (const query of queries)
      assert.equal(isAllowedOperation("POST", query), false, query);
    for (const mutation of mutations)
      assert.equal(isAllowedOperation("GET", mutation), false, mutation);
    assert.equal(
      isAllowedOperation("GET", "projects.list,projects.create"),
      false,
    );
    assert.equal(
      isAllowedOperation("POST", "projects.create,projects.list"),
      false,
    );
    for (const method of ["", "get", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
      assert.equal(isAllowedOperation(method, "projects.list"), false, method);
    }
  });

  it("rejects unknown, malformed, traversing, and oversized operation batches", () => {
    for (const path of [
      "",
      ",",
      "projects.list,",
      ",projects.list",
      "projects.list,,runs.list",
      "projects.list,unknown.method",
      "unknown.method",
      "../projects.list",
      "%2e%2e/projects.list",
      "projects.list/../runs.list",
      "projects.list%2Cruns.list",
      " projects.list",
      "projects.list ",
      "projects.list?other=1",
      Array(21).fill("projects.list").join(","),
    ]) {
      assert.equal(isAllowedOperation("GET", path), false, path);
    }
    assert.equal(
      isAllowedOperation("GET", Array(20).fill("projects.list").join(",")),
      true,
    );
  });
});

describe("manager proxy mutation origin policy", () => {
  it("requires the exact configured HTTPS origin", () => {
    assert.equal(
      isTrustedMutationOrigin(
        "https://manager.example",
        "https://manager.example",
      ),
      true,
    );
    assert.equal(
      isTrustedMutationOrigin(
        "https://manager.example:8443",
        "https://manager.example:8443/path",
      ),
      true,
    );
    for (const origin of [
      null,
      "",
      "null",
      "http://manager.example",
      "https://other.example",
      "https://manager.example:8443",
      "https://manager.example.evil.test",
      "https://manager.example/",
    ]) {
      assert.equal(
        isTrustedMutationOrigin(origin, "https://manager.example"),
        false,
        String(origin),
      );
    }
  });

  it("allows local HTTP origins only for exact localhost or loopback hosts", () => {
    assert.equal(
      isTrustedMutationOrigin("http://localhost:3000", "http://localhost:3000"),
      true,
    );
    assert.equal(
      isTrustedMutationOrigin("http://127.0.0.1:3000", "http://127.0.0.1:3000"),
      true,
    );
    assert.equal(
      isTrustedMutationOrigin("http://localhost:3001", "http://localhost:3000"),
      false,
    );
    assert.equal(
      isTrustedMutationOrigin(
        "http://localhost.evil.test:3000",
        "http://localhost.evil.test:3000",
      ),
      false,
    );
    assert.equal(
      isTrustedMutationOrigin("ftp://localhost", "ftp://localhost"),
      false,
    );
  });

  it("rejects missing, malformed, and non-HTTPS remote configuration", () => {
    for (const authUrl of [
      undefined,
      "",
      "not a url",
      "http://manager.example",
      "javascript:alert(1)",
    ]) {
      assert.equal(
        isTrustedMutationOrigin("https://manager.example", authUrl),
        false,
        String(authUrl),
      );
    }
  });
});

describe("manager hosted mode", () => {
  it("keeps production protected regardless of absent, false, or malformed flags", () => {
    for (const flag of [
      undefined,
      "false",
      "true",
      "",
      "FALSE",
      "0",
      "no",
      " false ",
    ]) {
      assert.equal(
        isHostedMode({ NODE_ENV: "production", MANAGER_HOSTED: flag }),
        true,
        String(flag),
      );
    }
  });

  it("allows local development only when the flag is absent or explicitly false", () => {
    for (const nodeEnv of ["development", "test"] as const) {
      assert.equal(isHostedMode({ NODE_ENV: nodeEnv }), false);
      assert.equal(
        isHostedMode({ NODE_ENV: nodeEnv, MANAGER_HOSTED: "false" }),
        false,
      );
      for (const flag of ["true", "", "TRUE", "False", "0", "no", " false "]) {
        assert.equal(
          isHostedMode({ NODE_ENV: nodeEnv, MANAGER_HOSTED: flag }),
          true,
          `${nodeEnv}: ${flag}`,
        );
      }
    }
  });
});

describe("manager login configuration", () => {
  const valid = {
    NODE_ENV: "production" as const,
    MANAGER_OWNER_ID: "16949569",
    AUTH_SECRET: "secret-fixture-for-testing-only-12345",
    AUTH_GITHUB_ID: "client-id-fixture",
    AUTH_GITHUB_SECRET: "client-secret-fixture",
    AUTH_URL: "https://manager.example",
  };

  it("accepts complete owner login configuration with a canonical HTTPS root", () => {
    assert.equal(isLoginConfigured(valid), true);
    assert.equal(
      isLoginConfigured({
        ...valid,
        AUTH_SECRET: "x".repeat(32),
        AUTH_URL: "https://manager.example/",
      }),
      true,
    );
    assert.equal(
      isLoginConfigured({
        ...valid,
        AUTH_URL: "https://manager.example:8443/",
      }),
      true,
    );
  });

  it("rejects missing or malformed owner IDs and incomplete credentials", () => {
    for (const id of [
      undefined,
      "",
      "0",
      "01",
      "-1",
      "1.2",
      "owner",
      " 12",
      "12 ",
    ]) {
      assert.equal(
        isLoginConfigured({ ...valid, MANAGER_OWNER_ID: id }),
        false,
        String(id),
      );
    }
    for (const secret of [undefined, "", "x".repeat(31)]) {
      assert.equal(isLoginConfigured({ ...valid, AUTH_SECRET: secret }), false);
    }
    for (const key of ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"] as const) {
      for (const value of [undefined, "", "  "]) {
        assert.equal(isLoginConfigured({ ...valid, [key]: value }), false, key);
      }
    }
  });

  it("rejects malformed, credentialed, non-root, query, hash, and insecure remote URLs", () => {
    for (const url of [
      undefined,
      "",
      "not-a-url",
      "ftp://manager.example",
      "http://manager.example",
      "https://user:pass@manager.example",
      "https://user@manager.example",
      "https://manager.example/path",
      "https://manager.example/?secret=1",
      "https://manager.example/#section",
      "https://manager.example?x=1",
      "https://manager.example#fragment",
    ]) {
      assert.equal(
        isLoginConfigured({ ...valid, AUTH_URL: url }),
        false,
        String(url),
      );
    }
  });

  it("allows localhost HTTP only outside production", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000/"]) {
      assert.equal(
        isLoginConfigured({ ...valid, NODE_ENV: "development", AUTH_URL: url }),
        true,
        url,
      );
      assert.equal(
        isLoginConfigured({ ...valid, NODE_ENV: "test", AUTH_URL: url }),
        true,
        url,
      );
      assert.equal(isLoginConfigured({ ...valid, AUTH_URL: url }), false, url);
    }
    assert.equal(
      isLoginConfigured({
        ...valid,
        NODE_ENV: "development",
        AUTH_URL: "http://localhost.evil.test",
      }),
      false,
    );
    assert.equal(
      isLoginConfigured({
        ...valid,
        NODE_ENV: "development",
        AUTH_URL: "http://127.0.0.2:3000",
      }),
      false,
    );
  });
});
