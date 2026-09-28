import type { BodyDef, HttpMethod, OperationDef, ParamDef, Tier } from "../../src/types.js";
import {
  ADMIN_TOOL,
  FULL_BY_DEFAULT_TOOLS,
  OVERRIDES,
  type Override,
  resolveRoute,
  toolFor,
  WRITE_SUFFIX,
} from "../../tool-map.js";
import { cleanDescription, normalizeSchema } from "./schema.js";

export type OpenApiSpec = {
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
};

type RawParam = { name: string; in: string; required?: boolean; description?: string; schema?: unknown };
type RawOp = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: RawParam[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { content?: Record<string, unknown> }>;
};

const METHODS: HttpMethod[] = ["GET", "POST", "PATCH", "DELETE"];
const PAGING = new Set(["Cursor", "PageSize"]);

export function autoAction(method: HttpMethod, path: string, base: string): string {
  const rest = path.slice(base.length).split("/").filter(Boolean);
  const literals = rest.filter((s) => !s.startsWith("{")).map((s) => s.replace(/-/g, "_"));
  const endsWithParam = rest.length > 0 && rest[rest.length - 1]?.startsWith("{");
  const verb =
    method === "GET"
      ? endsWithParam
        ? "get"
        : "list"
      : method === "POST"
        ? "create"
        : method === "PATCH"
          ? "update"
          : "delete";
  return [verb, ...literals].join("_");
}

export function defaultTier(method: HttpMethod, tool: string): Tier {
  if (method === "GET") return "read";
  if (method === "DELETE") return "full";
  if (FULL_BY_DEFAULT_TOOLS.has(tool)) return "full";
  return "write";
}

export interface Placement {
  tool: string;
  action: string;
  tier: Tier;
  forceBody?: Record<string, unknown>;
}

/**
 * Where one spec operation lands: its tool, action and tier, from tool-map.ts alone. An operation
 * with adminCopy lands twice. Needs no spec, so a test can hold the generated file to it offline.
 */
export function placements(
  operationId: string,
  method: HttpMethod,
  path: string,
  overrides: Record<string, Override> = OVERRIDES,
): Placement[] {
  const override = overrides[operationId] ?? {};
  const { tool, base } = resolveRoute(path);
  if (tool === ADMIN_TOOL || tool.endsWith(WRITE_SUFFIX))
    throw new Error(`${path} maps to the reserved tool name ${tool}; add a ROUTES entry in tool-map.ts`);
  const action = override.action ?? autoAction(method, path, base);
  const tier = override.tier ?? defaultTier(method, tool);
  const admin: Placement = {
    tool: ADMIN_TOOL,
    action: `${tool.replace(/^gorelo_/, "")}_${action}`,
    tier: "full",
  };
  if (tier === "full") return [admin];
  const own: Placement = {
    tool: toolFor(tool, method),
    action,
    tier,
    ...(override.forceBody ? { forceBody: override.forceBody } : {}),
  };
  return override.adminCopy ? [own, admin] : [own];
}

function planBody(op: RawOp, components: Record<string, unknown>, strip: string[]): BodyDef | undefined {
  const content = op.requestBody?.content;
  if (!content) return undefined;
  const contentType = content["application/json"]
    ? "application/json"
    : content["multipart/form-data"]
      ? "multipart/form-data"
      : undefined;
  if (!contentType) return undefined;
  const schema = normalizeSchema(content[contentType]?.schema, components);
  if (strip.length && schema.properties) {
    const props = { ...(schema.properties as Record<string, unknown>) };
    for (const key of strip) delete props[key];
    schema.properties = props;
    if (Array.isArray(schema.required))
      schema.required = schema.required.filter((r) => !strip.includes(r as string));
  }
  return { contentType, required: op.requestBody?.required === true, schema };
}

export function planOperations(
  spec: OpenApiSpec,
  overrides: Record<string, Override> = OVERRIDES,
): OperationDef[] {
  const components = spec.components?.schemas ?? {};
  const out: OperationDef[] = [];
  const used = new Set<string>();

  for (const [path, item] of Object.entries(spec.paths)) {
    const shared = (item.parameters as RawParam[] | undefined) ?? [];
    for (const method of METHODS) {
      const op = item[method.toLowerCase()] as RawOp | undefined;
      if (!op) continue;
      const operationId = op.operationId ?? `${method.toLowerCase()}_${path}`;
      if (Object.hasOwn(overrides, operationId)) used.add(operationId);

      const rawParams = [...shared, ...(op.parameters ?? [])];
      const params: ParamDef[] = rawParams
        .filter((p) => (p.in === "path" || p.in === "query") && !PAGING.has(p.name))
        .map((p) => ({
          name: p.name,
          in: p.in as "path" | "query",
          required: p.in === "path" || p.required === true,
          schema: normalizeSchema(p.schema, components),
          ...(p.description && cleanDescription(p.description)
            ? { description: cleanDescription(p.description) }
            : {}),
        }));

      const okContent = op.responses?.["200"]?.content ?? {};
      const response = Object.keys(okContent).some(
        (t) => t === "application/pdf" || t === "application/octet-stream",
      )
        ? "binary"
        : "json";

      const common = {
        operationId,
        method,
        path,
        summary: cleanDescription(op.summary ?? op.description ?? "") ?? `${method} ${path}`,
        params,
        response,
        paginated: rawParams.some((p) => p.name === "Cursor"),
      } as const;

      for (const placement of placements(operationId, method, path, overrides)) {
        // Forced fields are taken out of the schema, so the caller cannot even name them.
        const { forceBody, ...where } = placement;
        const body = planBody(op, components, Object.keys(forceBody ?? {}));
        out.push({ ...common, ...where, ...(body ? { body } : {}), ...(forceBody ? { forceBody } : {}) });
      }
    }
  }

  const seen = new Set<string>();
  for (const op of out) {
    const key = `${op.tool}.${op.action}`;
    if (seen.has(key))
      throw new Error(`Duplicate action ${key}; add an OVERRIDES entry in server/tool-map.ts`);
    seen.add(key);
  }
  for (const id of Object.keys(overrides)) {
    if (!used.has(id))
      throw new Error(`Unused override ${id} — Gorelo renamed or removed it; review tool-map.ts`);
  }
  return out.sort((a, b) => a.tool.localeCompare(b.tool) || a.action.localeCompare(b.action));
}
