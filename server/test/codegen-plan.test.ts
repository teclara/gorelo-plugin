import { describe, expect, it } from "vitest";
import { autoAction, planOperations } from "../scripts/codegen/plan.js";
import { resolveRoute } from "../tool-map.js";
import spec from "./fixtures/mini-spec.json" with { type: "json" };

const ops = planOperations(spec as never);
const find = (operationId: string, tool?: string) =>
  ops.find((o) => o.operationId === operationId && (!tool || o.tool === tool));

describe("autoAction", () => {
  it.each([
    ["GET", "/v1/tickets", "/v1/tickets", "list"],
    ["GET", "/v1/tickets/{ticketId}", "/v1/tickets", "get"],
    ["GET", "/v1/tickets/{ticketId}/comments", "/v1/tickets", "list_comments"],
    ["GET", "/v1/tickets/statuses", "/v1/tickets", "list_statuses"],
    ["POST", "/v1/tickets/{ticketId}/conversations/approval", "/v1/tickets", "create_conversations_approval"],
    ["PATCH", "/v1/clients", "/v1/clients", "update"],
    ["DELETE", "/v1/tickets/{ticketId}/comments/{commentId}", "/v1/tickets", "delete_comments"],
    ["GET", "/v1/work-types", "/v1", "list_work_types"],
  ] as const)("%s %s → %s", (method, path, base, expected) => {
    expect(autoAction(method, path, base)).toBe(expected);
  });
});

describe("resolveRoute", () => {
  it("routes project tasks, billing reference, and falls back to first segment", () => {
    expect(resolveRoute("/v1/projects/{projectId}/tasks/{taskId}")).toEqual({
      tool: "gorelo_project_tasks",
      base: "/v1/projects/{projectId}/tasks",
    });
    expect(resolveRoute("/v1/items/categories")).toEqual({ tool: "gorelo_billing_reference", base: "/v1" });
    expect(resolveRoute("/v1/time-entries/{id}")).toEqual({
      tool: "gorelo_time_entries",
      base: "/v1/time-entries",
    });
  });
});

describe("planOperations", () => {
  it("assigns tools, actions and default tiers", () => {
    expect(find("get_v1_tickets")).toMatchObject({
      tool: "gorelo_tickets",
      action: "list",
      tier: "read",
      paginated: true,
    });
    expect(find("post_v1_tickets")).toMatchObject({
      tool: "gorelo_tickets",
      action: "create",
      tier: "write",
    });
    expect(find("get_v1_taxes")).toMatchObject({ tool: "gorelo_billing_reference", action: "list_taxes" });
    expect(find("post_v1_projects_projectId_tasks")).toMatchObject({
      tool: "gorelo_project_tasks",
      action: "create",
    });
  });

  it("moves full-tier operations into gorelo_admin with resource-prefixed actions", () => {
    expect(find("delete_v1_tickets_ticketId")).toMatchObject({
      tool: "gorelo_admin",
      action: "tickets_delete",
      tier: "full",
    });
    expect(find("patch_v1_items_itemId")).toMatchObject({
      tool: "gorelo_admin",
      action: "items_update",
      tier: "full",
    });
    expect(ops.filter((o) => o.tier === "full").every((o) => o.tool === "gorelo_admin")).toBe(true);
    expect(ops.filter((o) => o.tool === "gorelo_admin").every((o) => o.tier === "full")).toBe(true);
  });

  it("forces draft invoices in the write tier and keeps an unforced admin copy", () => {
    const draft = find("post_v1_invoices", "gorelo_invoices");
    expect(draft).toMatchObject({ action: "create", tier: "write", forceBody: { StatusId: 1 } });
    const props = draft?.body?.schema.properties as Record<string, unknown>;
    expect(props.StatusId).toBeUndefined();
    const admin = find("post_v1_invoices", "gorelo_admin");
    expect(admin).toMatchObject({ action: "invoices_create", tier: "full" });
    expect(admin?.forceBody).toBeUndefined();
  });

  it("applies action overrides, binary responses and multipart bodies", () => {
    expect(find("get_v1_invoices_invoiceId_pdf")).toMatchObject({ action: "pdf", response: "binary" });
    expect(find("post_v1_attachments")).toMatchObject({
      action: "upload",
      body: { contentType: "multipart/form-data" },
    });
  });

  it("excludes Cursor/PageSize from params and prefers application/json bodies", () => {
    expect(find("get_v1_tickets")?.params.map((p) => p.name)).toEqual(["StatusIds"]);
    expect(find("post_v1_tickets")?.body).toMatchObject({ contentType: "application/json", required: true });
    expect(find("get_v1_tickets_ticketId")?.params[0]).toMatchObject({
      name: "ticketId",
      in: "path",
      required: true,
    });
  });

  it("throws when two operations map to the same tool+action", () => {
    const clash = {
      paths: {
        "/v1/a/x": { get: { operationId: "one", responses: {} } },
        "/v1/a/{id}/x": { get: { operationId: "two", responses: {} } },
      },
    };
    // "/v1/a/x" → list_x; "/v1/a/{id}/x" → list_x as well
    expect(() => planOperations(clash)).toThrow(/Duplicate action gorelo_a\.list_x/);
  });
});
