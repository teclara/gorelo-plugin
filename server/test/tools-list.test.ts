import { describe, expect, it } from "vitest";
import { OPERATIONS, SPEC_VERSION } from "../generated/operations.js";
import { MAX_DESCRIPTION_CHARS } from "../src/advertise.js";
import { GoreloClient } from "../src/http.js";
import { INSTRUCTIONS } from "../src/instructions.js";
import { paramsSchema, Registry } from "../src/registry.js";
import { type JsonSchema, TIER_RANK, type Tier } from "../src/types.js";

// Guards over what the real generated operations cost in context, and that the lean schema shown
// to the model never disagrees with the one the server validates against.
const registry = (tier: Tier) =>
  new Registry(OPERATIONS, tier, {
    client: new GoreloClient({ apiKey: "k", baseUrl: "https://x.test" }),
    dataDir: "/tmp",
  });

/** Claude Code truncates each tool description and the server instructions at this length. */
const CLIENT_TEXT_LIMIT = 2048;

/**
 * Upper bounds on JSON.stringify({tools}) per tier, roughly 10% above the measured size
 * (read 26.2k, write 65.2k, full 77.0k chars). Before the lean schema these were 38.7k, 92.5k
 * and 108.0k. Raise a bound only after looking at what grew.
 */
const MAX_TOOLS_LIST_CHARS: Record<Tier, number> = { read: 29_000, write: 72_000, full: 85_000 };

/** A schema with the parts the advertised copy is allowed to leave out removed. */
function shape(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(shape);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "description") continue;
    if (key === "additionalProperties" && value === false) continue;
    if (key === "required" && Array.isArray(value) && value.length === 0) continue;
    out[key] =
      key === "properties"
        ? Object.fromEntries(Object.entries(value as JsonSchema).map(([k, v]) => [k, shape(v)]))
        : shape(value);
  }
  return out;
}

function descriptions(schema: unknown, found: string[] = []): string[] {
  if (Array.isArray(schema)) for (const s of schema) descriptions(s, found);
  else if (schema && typeof schema === "object") {
    for (const [key, value] of Object.entries(schema)) {
      if (key === "description" && typeof value === "string") found.push(value);
      else descriptions(value, found);
    }
  }
  return found;
}

describe.each(["read", "write", "full"] as const)("tools/list in the %s tier", (tier) => {
  const tools = registry(tier).listTools();

  it("stays under its size budget", () => {
    expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(MAX_TOOLS_LIST_CHARS[tier]);
  });

  it("keeps every tool description short enough that Claude Code does not truncate it", () => {
    for (const t of tools) expect(t.description.length, t.name).toBeLessThanOrEqual(CLIENT_TEXT_LIMIT);
  });

  it("advertises every action with the same names, types, enums and required fields it validates", () => {
    const visible = OPERATIONS.filter((o) => TIER_RANK[o.tier] <= TIER_RANK[tier]);
    let branches = 0;
    for (const t of tools) {
      const params = (t.inputSchema.properties as Record<string, JsonSchema>).params!;
      for (const branch of params.anyOf as (JsonSchema & { title: string })[]) {
        const op = visible.find((o) => o.tool === t.name && o.action === branch.title);
        expect(op, `${t.name}.${branch.title}`).toBeDefined();
        const { title: _title, ...advertised } = branch;
        expect(shape(advertised), `${t.name}.${branch.title}`).toEqual(shape(paramsSchema(op!)));
        branches++;
      }
    }
    expect(branches).toBe(visible.length);
  });

  it("keeps property descriptions within the budget", () => {
    for (const t of tools) {
      const params = (t.inputSchema.properties as Record<string, JsonSchema>).params!;
      for (const d of descriptions(params.anyOf)) {
        expect(d.length, `${t.name}: ${d}`).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
        expect(d, t.name).not.toMatch(/Backend column|NVarChar/);
      }
    }
  });
});

describe("server instructions", () => {
  it("fit within what Claude Code keeps, including the spec version line", () => {
    expect(`${INSTRUCTIONS}\n(Gorelo API spec ${SPEC_VERSION})`.length).toBeLessThanOrEqual(
      CLIENT_TEXT_LIMIT,
    );
  });

  it("explain limit and cursor, which the advertised schemas leave undescribed", () => {
    expect(INSTRUCTIONS).toMatch(/params\.limit/);
    expect(INSTRUCTIONS).toMatch(/params\.cursor/);
  });
});

describe("validation is unaffected by the lean schema", () => {
  it("still rejects an unknown nested key and a wrong type before any HTTP call", async () => {
    const reg = registry("write");
    const unknownKey = await reg.call("gorelo_uptime_write", {
      action: "update",
      params: {
        id: "00000000-0000-0000-0000-000000000001",
        body: { MaintenanceMode: { Enabled: true, Nope: 1 } },
      },
    });
    expect(unknownKey.isError).toBe(true);
    expect(unknownKey.text).toMatch(/Invalid params.*Nope/);
    const wrongType = await reg.call("gorelo_tickets", { action: "get", params: { ticketId: 12 } });
    expect(wrongType.isError).toBe(true);
    expect(wrongType.text).toMatch(/Invalid params.*ticketId/);
  });
});
