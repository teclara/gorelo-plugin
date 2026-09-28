import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../generated/operations.js";

// Guards over the real generated operations: a spec drift PR must not quietly weaken a tier.
const name = (o: { tool: string; action: string }) => `${o.tool}.${o.action}`;

/** Every non-GET action reachable below the full tier. Adding one here is a deliberate review decision. */
const NON_GET_OUTSIDE_ADMIN = [
  "gorelo_alerts_write.create",
  "gorelo_attachments_write.upload",
  "gorelo_clients_write.create",
  "gorelo_clients_write.update",
  "gorelo_contacts_write.create",
  "gorelo_contacts_write.update",
  "gorelo_forms_write.create_submission_links",
  "gorelo_invoices_write.create",
  "gorelo_project_tasks_write.create",
  "gorelo_project_tasks_write.create_comments",
  "gorelo_project_tasks_write.create_conversations_approval",
  "gorelo_project_tasks_write.create_conversations_side_conversation",
  "gorelo_project_tasks_write.update",
  "gorelo_projects_write.create",
  "gorelo_projects_write.create_comments",
  "gorelo_projects_write.create_sections",
  "gorelo_projects_write.update",
  "gorelo_projects_write.update_sections",
  "gorelo_tickets_write.create",
  "gorelo_tickets_write.create_comments",
  "gorelo_tickets_write.create_conversations_approval",
  "gorelo_tickets_write.create_conversations_side_conversation",
  "gorelo_tickets_write.update",
  "gorelo_time_entries_write.create",
  "gorelo_time_entries_write.update",
  "gorelo_uptime_write.create",
  "gorelo_uptime_write.update",
];

describe("generated operation invariants", () => {
  it("write-tier gorelo_invoices_write.create forces a Draft and cannot be given a StatusId", () => {
    const create = OPERATIONS.find((o) => name(o) === "gorelo_invoices_write.create");
    expect(create?.tier).toBe("write");
    expect(create?.forceBody?.StatusId).toBe(1);
    const props = (create?.body?.schema.properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(props).map((k) => k.toLowerCase())).not.toContain("statusid");
    const required = (create?.body?.schema.required ?? []) as string[];
    expect(required.map((k) => k.toLowerCase())).not.toContain("statusid");
  });

  it("every DELETE and every full-tier op is in gorelo_admin, and vice versa", () => {
    for (const o of OPERATIONS) {
      if (o.method === "DELETE") expect(o.tool, name(o)).toBe("gorelo_admin");
      if (o.tier === "full") expect(o.tool, name(o)).toBe("gorelo_admin");
      if (o.tool === "gorelo_admin") expect(o.tier, name(o)).toBe("full");
    }
  });

  it("every read-tier op is a GET", () => {
    for (const o of OPERATIONS.filter((x) => x.tier === "read")) expect(o.method, name(o)).toBe("GET");
  });

  it("tools split reads from writes so the read tools can be auto-allowed", () => {
    for (const o of OPERATIONS) {
      if (o.tool === "gorelo_admin") continue;
      if (o.tool.endsWith("_write")) expect(o.method, name(o)).not.toBe("GET");
      else expect(o.method, name(o)).toBe("GET");
    }
  });

  it("non-GET actions outside gorelo_admin match the reviewed allowlist", () => {
    const actual = OPERATIONS.filter((o) => o.method !== "GET" && o.tool !== "gorelo_admin")
      .map(name)
      .sort();
    expect(actual).toEqual([...NON_GET_OUTSIDE_ADMIN].sort());
  });
});
