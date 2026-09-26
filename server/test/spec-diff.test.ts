import { describe, expect, it } from "vitest";
import { planOperations } from "../scripts/codegen/plan.js";
import { diffOperations, formatDiff } from "../scripts/spec-diff.js";
import spec from "./fixtures/mini-spec.json" with { type: "json" };

const before = planOperations(spec as never);

describe("diffOperations", () => {
  it("reports added, removed and changed operations with tool/action/tier", () => {
    const after = before
      .filter((o) => o.operationId !== "get_v1_taxes")
      .map((o) => (o.operationId === "get_v1_tickets" ? { ...o, summary: "Lists tickets (v2)." } : o))
      .concat([
        {
          ...before[0]!,
          operationId: "get_v1_new",
          method: "GET",
          path: "/v1/new",
          tool: "gorelo_new",
          action: "list",
          tier: "read",
        },
      ]);
    const diff = diffOperations(before, after);
    expect(diff.added).toEqual(["read  gorelo_new.list  GET /v1/new  [default-tier] [auto-name]"]);
    expect(diff.removed).toEqual(["read  gorelo_billing_reference.list_taxes  GET /v1/taxes"]);
    expect(diff.changed).toEqual(["read  gorelo_tickets.list  GET /v1/tickets"]);
  });

  it("tags added rows only for what OVERRIDES does not set", () => {
    const added = (id: string) => ({ ...before[0]!, operationId: id, action: id, tool: "gorelo_x" });
    const diff = diffOperations([], [added("a"), added("b"), added("c"), added("d")], {
      b: { tier: "write" },
      c: { action: "nice" },
      d: { tier: "full", action: "nicer" },
    });
    expect(diff.added.find((r) => r.includes(".a "))).toMatch(/\[default-tier\] \[auto-name\]$/);
    expect(diff.added.find((r) => r.includes(".b "))).toMatch(/ \[auto-name\]$/);
    expect(diff.added.find((r) => r.includes(".b "))).not.toContain("[default-tier]");
    expect(diff.added.find((r) => r.includes(".c "))).toMatch(/ \[default-tier\]$/);
    expect(diff.added.find((r) => r.includes(".d "))).not.toMatch(/\[/);
  });

  it("formats markdown with a review checklist that explains the tags", () => {
    const md = formatDiff({ added: ["a"], removed: [], changed: [] });
    expect(md).toContain("### Added (1)");
    expect(md).toContain("- [ ] Review tier");
    expect(md).toContain("[default-tier]");
    expect(md).toContain("[auto-name]");
  });

  it("reports nothing for identical input", () => {
    expect(diffOperations(before, before)).toEqual({ added: [], removed: [], changed: [] });
  });
});
