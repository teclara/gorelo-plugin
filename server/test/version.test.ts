import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as { version: string };

describe("version", () => {
  it("package.json and .claude-plugin/plugin.json agree", () => {
    expect(read(".claude-plugin/plugin.json").version).toBe(read("package.json").version);
  });

  it("the server takes its version from package.json rather than a hard-coded string", () => {
    const src = readFileSync("server/src/index.ts", "utf8");
    expect(src).toMatch(/from "\.\.\/\.\.\/package\.json" with \{ type: "json" \}/);
    expect(src).not.toMatch(/VERSION = "\d/);
  });
});
