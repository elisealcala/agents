import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("starter CLI", () => {
  it("runs successfully without model credentials", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./cli.ts", import.meta.url))],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: {},
        timeout: 5_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      "Agent starter ready. Replace this CLI with your agent workflow.",
    );
  });
});
