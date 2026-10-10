import type { HttpMethod, Tier } from "./src/types.js";

/** Holds every full-tier action (deletes, approvals, catalogue changes). */
export const ADMIN_TOOL = "gorelo_admin";
export const WRITE_SUFFIX = "_write";

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

/**
 * Keyed by the base tool name from resolveRoute (before the read/write split).
 * Tools whose new non-GET operations default to the full tier (money and catalogue changes).
 * Anything that should be reachable in the write tier needs an explicit OVERRIDES tier.
 */
export const FULL_BY_DEFAULT_TOOLS = new Set([
  "gorelo_invoices",
  "gorelo_contracts",
  "gorelo_items",
  "gorelo_billing_reference",
  "gorelo_payments",
]);

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
  // Billing tools default non-GET ops to full, so draft create must opt into write explicitly.
  post_v1_invoices: { tier: "write", forceBody: { StatusId: 1 }, adminCopy: true },
  post_v1_items: { tier: "full" },
  patch_v1_items_itemId: { tier: "full" },
  // Minting API keys is never a routine write: admin tier only.
  "post_v1_api-keys": { tier: "full" },
};

export function resolveRoute(path: string): { tool: string; base: string } {
  const route = ROUTES.find((r) => r.match.test(path));
  if (route) return { tool: route.tool, base: route.base };
  const segment = path.split("/").filter(Boolean)[1] ?? "misc";
  return { tool: `gorelo_${segment.replace(/-/g, "_")}`, base: `/v1/${segment}` };
}

/**
 * Read/write split. Claude Code grants permissions per tool, so below the full tier a GET stays
 * in the base tool (always read-only, safe to auto-allow) and every other method moves to
 * `<tool>_write`. A resource with no GETs, such as attachments, has only its `_write` tool.
 * Full-tier operations go to ADMIN_TOOL instead, whatever their method.
 */
export function toolFor(baseTool: string, method: HttpMethod): string {
  return method === "GET" ? baseTool : `${baseTool}${WRITE_SUFFIX}`;
}
