import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../generated/operations.js";

const SKILLS = [
  "gorelo-status",
  "gorelo-triage",
  "gorelo-client-overview",
  "gorelo-log-time",
  "gorelo-uptime-maintenance",
  "gorelo-invoice-draft",
];
const actions = new Set(OPERATIONS.map((o) => `${o.tool}.${o.action}`));

describe("skills", () => {
  it("exist with the expected names", () => {
    expect(readdirSync("skills").sort()).toEqual([...SKILLS].sort());
  });

  for (const name of SKILLS) {
    const text = readFileSync(join("skills", name, "SKILL.md"), "utf8");
    it(`${name} has name/description frontmatter`, () => {
      expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .{40,}\\n`));
    });
    it(`${name} description has no XML-like tags (claude.ai upload rejects them)`, () => {
      const description = text.match(/^description: (.*)$/m)?.[1] ?? "";
      expect(description).not.toMatch(/[<>]/);
    });
    it(`${name} only references real tool.actions`, () => {
      const refs = [...text.matchAll(/`(gorelo_[a-z_]+)\.([a-z_]+)`/g)].map((m) => `${m[1]}.${m[2]}`);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(actions, ref).toContain(ref);
    });
  }
});
