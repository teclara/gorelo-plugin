import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../generated/operations.js";
import { placements } from "../scripts/codegen/plan.js";
import type { OperationDef } from "../src/types.js";
import { ADMIN_TOOL, OVERRIDES, ROUTES, resolveRoute, toolFor } from "../tool-map.js";

// Codegen needs the network and the spec is not committed, so CI cannot rerun it. These tests hold
// the committed server/generated/operations.ts to server/tool-map.ts offline instead: editing the
// tool map without running `npm run codegen` fails here.
const byOperation = new Map<string, OperationDef[]>();
for (const op of OPERATIONS)
  byOperation.set(op.operationId, [...(byOperation.get(op.operationId) ?? []), op]);

const placed = (op: OperationDef) => ({
  tool: op.tool,
  action: op.action,
  tier: op.tier,
  ...(op.forceBody ? { forceBody: op.forceBody } : {}),
});
const byTool = (a: { tool: string }, b: { tool: string }) => a.tool.localeCompare(b.tool);

describe("generated operations match tool-map.ts", () => {
  it("every operation sits in the tool, action and tier the tool map gives it", () => {
    expect(byOperation.size).toBeGreaterThan(0);
    for (const [operationId, ops] of byOperation) {
      const { method, path } = ops[0]!;
      for (const op of ops) expect({ method: op.method, path: op.path }).toEqual({ method, path });
      expect(ops.map(placed).sort(byTool), operationId).toEqual(
        placements(operationId, method, path).sort(byTool),
      );
    }
  });

  it("every operation's tool follows resolveRoute and the read/write split", () => {
    for (const op of OPERATIONS) {
      if (op.tool === ADMIN_TOOL) continue;
      const expected = toolFor(resolveRoute(op.path).tool, op.method);
      expect(op.tool, `${op.operationId} ${op.method} ${op.path}`).toBe(expected);
    }
  });

  it("every ROUTES entry is used by a generated operation", () => {
    for (const route of ROUTES) {
      expect(
        OPERATIONS.some((o) => route.match.test(o.path)),
        String(route.match),
      ).toBe(true);
    }
  });

  describe.each(Object.entries(OVERRIDES))("override %s", (operationId, override) => {
    const ops = byOperation.get(operationId) ?? [];
    const own = ops.filter((o) => o.tool !== ADMIN_TOOL);
    const admin = ops.filter((o) => o.tool === ADMIN_TOOL);

    it("names an operation that was generated", () => {
      expect(ops.length).toBeGreaterThan(0);
    });

    if (override.action) {
      it(`is named ${override.action}`, () => {
        for (const o of own) expect(o.action).toBe(override.action);
        for (const o of admin) expect(o.action.endsWith(`_${override.action}`), o.action).toBe(true);
      });
    }

    if (override.tier) {
      it(`is in the ${override.tier} tier`, () => {
        const primary = override.tier === "full" ? admin : own;
        expect(primary.map((o) => o.tier)).toEqual([override.tier]);
        if (override.tier === "full") expect(own).toEqual([]);
      });
    }

    if (override.forceBody) {
      const forced = Object.keys(override.forceBody).map((k) => k.toLowerCase());
      it("forces its body fields and hides them from the schema", () => {
        expect(own).toHaveLength(1);
        expect(own[0]!.forceBody).toEqual(override.forceBody);
        const schema = own[0]!.body?.schema ?? {};
        const offered = [...Object.keys(schema.properties ?? {}), ...((schema.required as string[]) ?? [])];
        for (const key of offered) expect(forced).not.toContain(key.toLowerCase());
      });
    }

    it(
      override.adminCopy
        ? "has an unforced full-tier copy in gorelo_admin"
        : "has no extra copy in gorelo_admin",
      () => {
        if (!override.adminCopy) {
          expect(ops).toHaveLength(1);
          return;
        }
        expect(admin).toHaveLength(1);
        expect(admin[0]).toMatchObject({ tier: "full" });
        expect(admin[0]!.forceBody).toBeUndefined();
        const props = Object.keys(admin[0]!.body?.schema.properties ?? {});
        for (const key of Object.keys(override.forceBody ?? {})) expect(props).toContain(key);
      },
    );
  });
});
