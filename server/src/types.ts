export type Tier = "read" | "write" | "full";
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type JsonSchema = { [key: string]: unknown };

export const TIER_RANK: Record<Tier, number> = { read: 0, write: 1, full: 2 };

export interface ParamDef {
  name: string;
  in: "path" | "query";
  required: boolean;
  schema: JsonSchema;
  description?: string;
}

export interface BodyDef {
  contentType: "application/json" | "multipart/form-data";
  required: boolean;
  schema: JsonSchema;
}

export interface OperationDef {
  operationId: string;
  method: HttpMethod;
  path: string;
  /** MCP tool name, e.g. "gorelo_tickets" or "gorelo_admin". */
  tool: string;
  /** Action within the tool, e.g. "list_comments" or (admin) "tickets_delete". */
  action: string;
  tier: Tier;
  summary: string;
  /** Path and query params, excluding Cursor and PageSize. */
  params: ParamDef[];
  body?: BodyDef;
  /** Body fields the server always sets, overriding the caller (e.g. StatusId: 1 for draft invoices). */
  forceBody?: Record<string, unknown>;
  response: "json" | "binary";
  /** True when the operation accepts Cursor/PageSize. */
  paginated: boolean;
}
