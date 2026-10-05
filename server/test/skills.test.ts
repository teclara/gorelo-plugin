import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../generated/operations.js";
import type { JsonSchema, OperationDef } from "../src/types.js";

const SKILLS = [
  "gorelo-status",
  "gorelo-triage",
  "gorelo-client-overview",
  "gorelo-log-time",
  "gorelo-uptime-maintenance",
  "gorelo-invoice-draft",
];
const byName = new Map(OPERATIONS.map((o) => [`${o.tool}.${o.action}`, o]));

/**
 * Every parameter a skill names in backticks, by the action it is passed to. Checked both ways:
 * the action must accept the parameter, and the skill must still mention both. Body fields are
 * listed by name, wherever they sit in the body.
 */
const PARAMS_USED: Record<string, Record<string, string[]>> = {
  "gorelo-status": {
    "gorelo_organization.list_users": ["limit"],
    "gorelo_clients.list": ["limit"],
  },
  "gorelo-triage": {
    "gorelo_tickets.list": ["StatusIds", "SortBy", "UpdatedSince", "PriorityIds", "limit", "cursor"],
    "gorelo_assets.list_agents": ["ClientIds", "StatusIds", "limit"],
    "gorelo_uptime.list": ["limit"],
    "gorelo_tickets_write.update": ["ticketId", "LeadAssigneeId"],
    "gorelo_tickets_write.create_comments": ["ticketId", "ConversationTypeId", "Body"],
  },
  "gorelo-client-overview": {
    "gorelo_clients.list": ["Query"],
    "gorelo_clients.get": ["clientId"],
    "gorelo_clients.list_locations": ["clientId"],
    "gorelo_contacts.list": ["ClientIds"],
    "gorelo_assets.list_agents": ["ClientIds"],
    "gorelo_assets.list_custom": ["ClientIds"],
    "gorelo_tickets.list": ["ClientIds", "StatusIds"],
    "gorelo_contracts.list": ["ClientIds"],
    "gorelo_contracts.get": ["contractId"],
    "gorelo_uptime.list": ["ClientIds"],
    "gorelo_time_entries.list": ["ClientIds", "StartedSince"],
  },
  "gorelo-log-time": {
    "gorelo_tickets.list": ["Query", "ClientIds"],
    "gorelo_tickets.get": ["ticketId"],
    "gorelo_projects.list": ["Query", "ClientIds"],
    "gorelo_project_tasks.list": ["projectId"],
    "gorelo_time_entries_write.create": [
      "TicketId",
      "TaskId",
      "UserId",
      "StartedOn",
      "EndedOn",
      "ActualHours",
      "WorkTypeId",
      "BillingRoleId",
      "Comment",
    ],
  },
  "gorelo-uptime-maintenance": {
    "gorelo_clients.list": ["Query"],
    "gorelo_uptime.list": ["ClientIds", "Query"],
    "gorelo_uptime.get": ["checkId"],
    "gorelo_uptime_write.update": [
      "checkId",
      "MaintenanceMode",
      "Enabled",
      "StartDateTime",
      "DurationInMinutes",
      "Reason",
    ],
  },
  "gorelo-invoice-draft": {
    "gorelo_clients.list": ["Query"],
    "gorelo_time_entries.list": ["ClientIds", "StartedSince", "StartedBefore"],
    "gorelo_invoices.list": ["ClientIds", "InvoiceDateSince", "InvoiceDateBefore"],
    "gorelo_contracts.list": ["ClientIds"],
    "gorelo_contracts.get": ["contractId"],
    "gorelo_invoices.pdf": ["invoiceId"],
    "gorelo_invoices_write.create": [
      "ClientId",
      "LineItems",
      "InvoiceDate",
      "DueDate",
      "Reference",
      "ItemId",
      "Quantity",
      "Description",
      "UnitPrice",
      "TaxId",
      "DiscountPercent",
      "BillableStatusId",
    ],
  },
};

/**
 * Backticked identifiers that are fields of a result, not parameters. Every other backticked
 * identifier in a skill has to be a parameter listed in PARAMS_USED, so a new one cannot be
 * added without being checked against the generated operations.
 */
const RESULT_FIELDS: Record<string, string[]> = {
  "gorelo-status": [],
  "gorelo-triage": ["UpdatedOn", "Sla", "MaintenanceMode"],
  "gorelo-client-overview": ["Id"],
  "gorelo-log-time": ["Id", "DisplayNumber"],
  "gorelo-uptime-maintenance": [],
  "gorelo-invoice-draft": ["BillableStatus", "Id"],
};

/**
 * The type of each id a skill passes in a path. A ticket number such as 1042 is not a ticketId;
 * if Gorelo changes one of these, the skill that resolves the id needs another look.
 */
const ID_TYPES: Record<string, Record<string, string>> = {
  "gorelo_tickets.get": { ticketId: "uuid" },
  "gorelo_tickets_write.update": { ticketId: "uuid" },
  "gorelo_tickets_write.create_comments": { ticketId: "uuid" },
  "gorelo_project_tasks.list": { projectId: "uuid" },
  "gorelo_clients.get": { clientId: "integer" },
  "gorelo_clients.list_locations": { clientId: "integer" },
  "gorelo_contracts.get": { contractId: "integer" },
  "gorelo_uptime.get": { checkId: "uuid" },
  "gorelo_uptime_write.update": { checkId: "uuid" },
  "gorelo_invoices.pdf": { invoiceId: "uuid" },
};

function bodyFields(schema: JsonSchema | undefined, found = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== "object") return found;
  for (const [key, value] of Object.entries((schema.properties ?? {}) as Record<string, JsonSchema>)) {
    found.add(key);
    bodyFields(value, found);
  }
  bodyFields(schema.items as JsonSchema | undefined, found);
  return found;
}

function accepted(op: OperationDef): Set<string> {
  const names = bodyFields(op.body?.schema);
  for (const p of op.params) names.add(p.name);
  if (op.paginated) for (const n of ["limit", "cursor"]) names.add(n);
  return names;
}

/** Backticked words that look like a Gorelo field or id: `ClientIds`, `ticketId`, `id`, `limit`. */
function identifiers(text: string): string[] {
  const found = [...text.matchAll(/`([A-Za-z]+)(?:[:.][^`]*)?`/g)].map((m) => m[1]!);
  return [...new Set(found.filter((w) => /^[A-Z]/.test(w) || /^(id|limit|cursor|[a-z]+Id)$/.test(w)))];
}

describe("skills", () => {
  it("exist with the expected names", () => {
    expect(readdirSync("skills").sort()).toEqual([...SKILLS].sort());
    expect(Object.keys(PARAMS_USED).sort()).toEqual([...SKILLS].sort());
  });

  it("pass ids of the type each action takes", () => {
    for (const [ref, ids] of Object.entries(ID_TYPES)) {
      for (const [param, type] of Object.entries(ids)) {
        const schema = byName.get(ref)?.params.find((p) => p.name === param && p.in === "path")?.schema;
        expect(schema?.format ?? schema?.type, `${ref} ${param}`).toBe(type);
      }
    }
  });

  for (const name of SKILLS) {
    const text = readFileSync(join("skills", name, "SKILL.md"), "utf8");
    const used = PARAMS_USED[name] ?? {};

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
      for (const ref of refs) expect([...byName.keys()], ref).toContain(ref);
    });
    it(`${name} only names parameters the action accepts`, () => {
      for (const [ref, params] of Object.entries(used)) {
        const op = byName.get(ref);
        expect(op, ref).toBeDefined();
        expect(text, `${name} no longer mentions ${ref}`).toContain(`\`${ref}\``);
        const names = accepted(op!);
        for (const param of params) {
          expect([...names], `${ref} has no parameter ${param}`).toContain(param);
          expect(identifiers(text), `${name} no longer mentions ${param}`).toContain(param);
        }
      }
    });
    it(`${name} has every backticked field classified as a checked parameter or a result field`, () => {
      const known = new Set([...Object.values(used).flat(), ...(RESULT_FIELDS[name] ?? [])]);
      for (const word of identifiers(text)) expect([...known], `${name}: \`${word}\``).toContain(word);
    });
    it(`${name} takes path ids only for actions whose id type is recorded`, () => {
      for (const [ref, params] of Object.entries(used)) {
        const pathIds = byName.get(ref)!.params.filter((p) => p.in === "path" && params.includes(p.name));
        for (const p of pathIds) expect(ID_TYPES[ref]?.[p.name], `${ref} ${p.name}`).toBeDefined();
      }
    });
  }

  it("gorelo-log-time resolves a ticket number by search, never by passing it to get", () => {
    const text = readFileSync(join("skills", "gorelo-log-time", "SKILL.md"), "utf8");
    expect(text).not.toMatch(/`gorelo_tickets\.get` if the user gave a number/);
    expect(text).toMatch(/`gorelo_tickets\.list` with `Query`/);
    expect(byName.get("gorelo_tickets.list")?.params.find((p) => p.name === "Query")?.description).toMatch(
      /number/,
    );
  });
});
