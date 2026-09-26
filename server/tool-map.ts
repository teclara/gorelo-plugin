import type { Tier } from "./src/types.js";

export interface Route {
  match: RegExp;
  tool: string;
  /** Path prefix stripped before deriving the action name. */
  base: string;
}

/** Checked in order; anything unmatched falls back to one tool per first path segment. */
export const ROUTES: Route[] = [
  {
    match: /^\/v1\/projects\/\{projectId\}\/tasks(\/|$)/,
    tool: "gorelo_project_tasks",
    base: "/v1/projects/{projectId}/tasks",
  },
  {
    match: /^\/v1\/(taxes|work-types|billing-roles|items\/categories)(\/|$)/,
    tool: "gorelo_billing_reference",
    base: "/v1",
  },
];

export interface Override {
  action?: string;
  tier?: Tier;
  /** Body fields forced by the server (the caller cannot set them). */
  forceBody?: Record<string, unknown>;
  /** Also expose an unforced copy of this operation in gorelo_admin (tier full). */
  adminCopy?: boolean;
}

/** Keyed by Gorelo operationId. */
export const OVERRIDES: Record<string, Override> = {
  get_v1_invoices_invoiceId_pdf: { action: "pdf" },
  post_v1_attachments: { action: "upload" },
  post_v1_invoices: { forceBody: { StatusId: 1 }, adminCopy: true },
  post_v1_items: { tier: "full" },
  patch_v1_items_itemId: { tier: "full" },
};

export function resolveRoute(path: string): { tool: string; base: string } {
  const route = ROUTES.find((r) => r.match.test(path));
  if (route) return { tool: route.tool, base: route.base };
  const segment = path.split("/").filter(Boolean)[1] ?? "misc";
  return { tool: `gorelo_${segment.replace(/-/g, "_")}`, base: `/v1/${segment}` };
}
