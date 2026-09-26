import { readFile } from "node:fs/promises";
import type { OperationDef } from "../src/types.js";
import { OVERRIDES, type Override } from "../tool-map.js";
import { type OpenApiSpec, planOperations } from "./codegen/plan.js";

type Diff = { added: string[]; removed: string[]; changed: string[] };

const label = (o: OperationDef) => `${o.tier.padEnd(5)} ${o.tool}.${o.action}  ${o.method} ${o.path}`;
const key = (o: OperationDef) => `${o.tool}.${o.action}`;

/** Flags added rows whose tier or name came from defaults rather than a reviewed OVERRIDES entry. */
function addedLabel(o: OperationDef, overrides: Record<string, Override>): string {
  const override = overrides[o.operationId];
  const tags = [...(override?.tier ? [] : ["[default-tier]"]), ...(override?.action ? [] : ["[auto-name]"])];
  return tags.length ? `${label(o)}  ${tags.join(" ")}` : label(o);
}

export function diffOperations(
  before: OperationDef[],
  after: OperationDef[],
  overrides: Record<string, Override> = OVERRIDES,
): Diff {
  const b = new Map(before.map((o) => [key(o), o]));
  const a = new Map(after.map((o) => [key(o), o]));
  return {
    added: [...a.values()]
      .filter((o) => !b.has(key(o)))
      .map((o) => addedLabel(o, overrides))
      .sort(),
    removed: [...b.values()]
      .filter((o) => !a.has(key(o)))
      .map(label)
      .sort(),
    changed: [...a.values()]
      .filter((o) => b.has(key(o)) && JSON.stringify(b.get(key(o))) !== JSON.stringify(o))
      .map(label)
      .sort(),
  };
}

export function formatDiff(d: Diff): string {
  const section = (title: string, rows: string[]) =>
    rows.length ? [`### ${title} (${rows.length})`, "```", ...rows, "```"].join("\n") : "";
  return [
    "## Gorelo API spec changed",
    section("Added", d.added),
    section("Removed", d.removed),
    section("Changed", d.changed),
    "### Review",
    "- [ ] Review tier for every added operation, especially rows tagged `[default-tier]` (GET defaults to read; POST/PATCH to write, or full on invoices/contracts/items/billing reference; DELETE to full)",
    "- [ ] Add friendly action names in `server/tool-map.ts` for rows tagged `[auto-name]` where the automatic name is unclear",
    "- [ ] Update skills if a removed or renamed action is referenced (the skills test will fail if so)",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// CLI: tsx server/scripts/spec-diff.ts <new-spec.json>  → prints markdown; exit 0 always
if (process.argv[1]?.endsWith("spec-diff.ts")) {
  const { OPERATIONS } = await import("../generated/operations.js");
  const next = planOperations(JSON.parse(await readFile(process.argv[2]!, "utf8")) as OpenApiSpec);
  console.log(formatDiff(diffOperations(OPERATIONS, next)));
}
