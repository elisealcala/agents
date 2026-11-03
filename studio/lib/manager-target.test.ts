import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { managerTarget } from "./manager-target.ts";

describe("configured manager target", () => {
  it("preserves the root or tRPC prefix and query for valid operations", () => {
    assert.equal(
      managerTarget(
        "http://127.0.0.1:8788",
        "projects.list",
        "?batch=1&input=%7B%7D",
        true,
      )?.href,
      "http://127.0.0.1:8788/projects.list?batch=1&input=%7B%7D",
    );
    assert.equal(
      managerTarget(
        "https://manager.internal/trpc/",
        "agent.identity,projects.list",
        "",
      )?.href,
      "https://manager.internal/trpc/agent.identity,projects.list",
    );
    assert.equal(
      managerTarget("https://manager.internal/", "projects.create", "?batch=1")
        ?.href,
      "https://manager.internal/projects.create?batch=1",
    );
  });

  it("requires HTTPS except for explicitly permitted loopback during local testing", () => {
    for (const url of [
      "http://localhost:8788/",
      "http://127.0.0.1:8788/trpc/",
    ]) {
      assert.equal(managerTarget(url, "projects.list", ""), null, url);
      assert.equal(managerTarget(url, "projects.list", "", false), null, url);
      assert.equal(
        managerTarget(url, "projects.list", "", true)?.protocol,
        "http:",
        url,
      );
    }
    for (const url of [
      "http://manager.internal/",
      "http://example.com/trpc/",
      "http://localhost.evil.test/",
      "http://127.0.0.2:8788/",
      "http://[::1]:8788/",
    ]) {
      assert.equal(managerTarget(url, "projects.list", ""), null, url);
      assert.equal(managerTarget(url, "projects.list", "", true), null, url);
    }
    assert.equal(
      managerTarget("https://manager.internal/", "projects.list", "")?.protocol,
      "https:",
    );
    assert.equal(
      managerTarget("https://localhost:8788/", "projects.list", "")?.protocol,
      "https:",
    );
  });

  it("does not allow loopback mode to bypass credential or path validation", () => {
    for (const url of [
      "http://user:pass@localhost:8788/",
      "http://localhost:8788/unexpected/",
      "http://localhost:8788/trpc",
      "http://localhost:8788/?token=secret",
      "http://localhost:8788/#fragment",
    ]) {
      assert.equal(managerTarget(url, "projects.list", "", true), null, url);
    }
  });

  it("rejects missing, malformed, credentialed and unsupported backend URLs", () => {
    for (const rawUrl of [
      undefined,
      "",
      "not a URL",
      "ftp://manager.internal/",
      "javascript:alert(1)",
      "http://user:pass@manager.internal/",
      "https://user@manager.internal/",
      "https://manager.internal/?key=value",
      "https://manager.internal/#fragment",
      "https://manager.internal/api/",
      "https://manager.internal/trpc",
      "https://manager.internal/trpc/extra/",
    ]) {
      assert.equal(
        managerTarget(rawUrl, "projects.list", ""),
        null,
        String(rawUrl),
      );
    }
  });

  it("rejects malformed, traversing and injected operation names", () => {
    for (const operation of [
      "",
      ".",
      "..",
      "../projects.list",
      "projects.list/../runs.list",
      "%2e%2e/projects.list",
      "projects.list?secret=value",
      "projects.list#fragment",
      "projects.list,runs.list,",
      ",projects.list",
      "projects.list,,runs.list",
      "projects.list%2Cruns.list",
      "projects.list ",
      " projects.list",
      "projects_1.list",
    ]) {
      assert.equal(
        managerTarget("https://manager.internal/trpc/", operation, ""),
        null,
        operation,
      );
    }
  });

  it("rejects a search without a leading question mark or with a fragment", () => {
    for (const search of ["batch=1", "#fragment", "?batch=1#fragment"]) {
      assert.equal(
        managerTarget("https://manager.internal/", "projects.list", search),
        null,
        search,
      );
    }
    assert.equal(
      managerTarget(
        "https://manager.internal/trpc/",
        "projects.list",
        "?input=%23value",
      )?.search,
      "?input=%23value",
    );
  });
});
