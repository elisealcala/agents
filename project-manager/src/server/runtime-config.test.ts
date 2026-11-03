import { describe, expect, it } from "vitest";
import { resolveRuntimeConfig } from "./runtime-config.ts";

const env = {
  PROJECT_MANAGER_LIBRARY_ROOT: "/tmp/manager-evidence",
  PROJECT_MANAGER_CLASSIFIER_URL: "http://classifier:8789",
  PROJECT_MANAGER_MODEL: "fixture-model",
  ANTHROPIC_API_KEY: "private-key-fixture",
};

describe("manager runtime configuration status", () => {
  it("reports missing configuration and provides a local classifier default", () => {
    expect(resolveRuntimeConfig({})).toEqual({
      libraryRoot: null,
      classifierUrl: "http://127.0.0.1:8789/",
      model: null,
      capabilities: {
        evidence: "unconfigured",
        model: "unconfigured",
        intake: "unconfigured",
        conversation: "unconfigured",
      },
    });
  });

  it("reports configured dependencies without returning the provider key", () => {
    const result = resolveRuntimeConfig(env);
    expect(result).toEqual({
      libraryRoot: "/tmp/manager-evidence",
      classifierUrl: "http://classifier:8789/",
      model: "fixture-model",
      capabilities: {
        evidence: "configured",
        model: "configured",
        intake: "configured",
        conversation: "configured",
      },
    });
    expect(JSON.stringify(result)).not.toContain(env.ANTHROPIC_API_KEY);
  });

  it("withholds evidence-dependent capabilities for missing or relative library roots", () => {
    for (const root of [undefined, "", "  ", "relative/path"]) {
      const result = resolveRuntimeConfig({
        ...env,
        PROJECT_MANAGER_LIBRARY_ROOT: root,
      });
      expect(result.libraryRoot).toBeNull();
      expect(result.capabilities).toEqual({
        evidence: "unconfigured",
        model: "configured",
        intake: "unconfigured",
        conversation: "unconfigured",
      });
    }
  });

  it("rejects an absolute evidence path containing a NUL character", () => {
    const result = resolveRuntimeConfig({
      ...env,
      PROJECT_MANAGER_LIBRARY_ROOT: "/tmp/manager\0evidence",
    });
    expect(result.libraryRoot).toBeNull();
    expect(result.capabilities).toEqual({
      evidence: "unconfigured",
      model: "configured",
      intake: "unconfigured",
      conversation: "unconfigured",
    });
  });

  it("rejects invalid, unsupported, and credential-bearing classifier URLs without echoing them", () => {
    for (const url of [
      "not a URL",
      "file:///tmp/private",
      "https://user:private-password@example.com/",
    ]) {
      const result = resolveRuntimeConfig({
        ...env,
        PROJECT_MANAGER_CLASSIFIER_URL: url,
      });
      expect(result.classifierUrl).toBeNull();
      expect(result.capabilities.evidence).toBe("unconfigured");
      expect(result.capabilities.intake).toBe("unconfigured");
      expect(result.capabilities.conversation).toBe("unconfigured");
      expect(JSON.stringify(result)).not.toContain(url);
      expect(JSON.stringify(result)).not.toContain("private-password");
    }
  });

  it("supports the ingest model fallback but requires both a real model name and a key", () => {
    const fallback = resolveRuntimeConfig({
      ...env,
      PROJECT_MANAGER_MODEL: "  ",
      INGEST_MODEL: "fallback-model",
    });
    expect(fallback.model).toBe("fallback-model");
    expect(fallback.capabilities.model).toBe("configured");
    expect(fallback.capabilities.intake).toBe("configured");

    for (const overrides of [
      { PROJECT_MANAGER_MODEL: "", INGEST_MODEL: "" },
      { ANTHROPIC_API_KEY: "  " },
      { PROJECT_MANAGER_MODEL: "unconfigured" },
    ]) {
      const result = resolveRuntimeConfig({ ...env, ...overrides });
      expect(result.capabilities.model).toBe("unconfigured");
      expect(result.capabilities.intake).toBe("unconfigured");
      expect(result.capabilities.conversation).toBe("unconfigured");
      expect(result.capabilities.evidence).toBe("configured");
    }
  });
});
