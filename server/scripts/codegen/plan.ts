import type { BodyDef, HttpMethod, OperationDef, ParamDef, Tier } from "../../src/types.js";
import { OVERRIDES, resolveRoute } from "../../tool-map.js";
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

function defaultTier(method: HttpMethod): Tier {
  if (method === "GET") return "read";
  if (method === "DELETE") return "full";
  return "write";
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

export function planOperations(spec: OpenApiSpec): OperationDef[] {
  const components = spec.components?.schemas ?? {};
  const out: OperationDef[] = [];

  for (const [path, item] of Object.entries(spec.paths)) {
    const shared = (item.parameters as RawParam[] | undefined) ?? [];
    for (const method of METHODS) {
      const op = item[method.toLowerCase()] as RawOp | undefined;
      if (!op) continue;
      const operationId = op.operationId ?? `${method.toLowerCase()}_${path}`;
      const override = OVERRIDES[operationId] ?? {};
      const { tool, base } = resolveRoute(path);
      const action = override.action ?? autoAction(method, path, base);
      const tier = override.tier ?? defaultTier(method);

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

      const resource = tool.replace(/^gorelo_/, "");
      const strip = Object.keys(override.forceBody ?? {});

      if (tier === "full") {
        out.push({
          ...common,
          tool: "gorelo_admin",
          action: `${resource}_${action}`,
          tier,
          body: planBody(op, components, []),
        });
      } else {
        const body = planBody(op, components, strip);
        out.push({
          ...common,
          tool,
          action,
          tier,
          ...(body ? { body } : {}),
          ...(override.forceBody ? { forceBody: override.forceBody } : {}),
        });
        if (override.adminCopy) {
          out.push({
            ...common,
            tool: "gorelo_admin",
            action: `${resource}_${action}`,
            tier: "full",
            body: planBody(op, components, []),
          });
        }
      }
    }
  }

  const seen = new Set<string>();
  for (const op of out) {
    const key = `${op.tool}.${op.action}`;
    if (seen.has(key))
      throw new Error(`Duplicate action ${key}; add an OVERRIDES entry in server/tool-map.ts`);
    seen.add(key);
    if (op.body === undefined) delete op.body;
  }
  return out.sort((a, b) => a.tool.localeCompare(b.tool) || a.action.localeCompare(b.action));
}
