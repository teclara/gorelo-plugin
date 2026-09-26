import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { appendAudit } from "./audit.js";
import type { GoreloClient } from "./http.js";
import { collectPages, DEFAULT_LIMIT, MAX_LIMIT, markUntrusted, PAGE_SIZE, renderResult } from "./shape.js";
import { type JsonSchema, type OperationDef, TIER_RANK, type Tier } from "./types.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: true };
}

const TOOL_BLURBS: Record<string, string> = {
  gorelo_admin:
    "DESTRUCTIVE Gorelo actions: deletes, voiding/approving invoices, catalogue item changes. Confirm with the user first.",
};

// ajv-formats is CJS (module.exports = formatsPlugin); its .d.ts types the default export as a
// Plugin object, but under NodeNext/esModuleInterop the runtime value is the callable plugin
// itself (sometimes surfaced as `.default`). Verified callable at runtime; cast through unknown
// since the declared type has no call signature.
type AjvFormatsPlugin = (ajv: Ajv) => void;
const applyFormats: AjvFormatsPlugin =
  (addFormats as unknown as { default?: AjvFormatsPlugin }).default ??
  (addFormats as unknown as AjvFormatsPlugin);

function paramsSchema(op: OperationDef): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const p of op.params) {
    properties[p.name] = p.description ? { ...p.schema, description: p.description } : p.schema;
    if (p.required) required.push(p.name);
  }
  if (op.paginated) {
    properties.limit = {
      type: "integer",
      minimum: 1,
      description: `Max items to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
    };
    properties.cursor = { type: "string", description: "next_cursor from a previous call, to continue." };
  }
  if (op.body?.contentType === "multipart/form-data") {
    const props = { ...((op.body.schema.properties as Record<string, JsonSchema>) ?? {}) };
    delete props.file;
    properties.file_path = { type: "string", description: "Absolute path of the local file to upload." };
    properties.body = { type: "object", properties: props, additionalProperties: false };
    required.push("file_path");
  } else if (op.body) {
    properties.body = op.body.schema;
    if (op.body.required) required.push("body");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export class Registry {
  private readonly byTool = new Map<string, Map<string, OperationDef>>();
  private readonly allByTool = new Map<string, Map<string, OperationDef>>();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly ajv = new Ajv({ allErrors: true, strict: false });

  constructor(
    ops: OperationDef[],
    private readonly tier: Tier,
    private readonly deps: { client: GoreloClient; dataDir: string },
  ) {
    applyFormats(this.ajv);
    for (const op of ops) {
      const all = this.allByTool.get(op.tool) ?? new Map();
      all.set(op.action, op);
      this.allByTool.set(op.tool, all);
      if (TIER_RANK[op.tier] > TIER_RANK[tier]) continue;
      const allowed = this.byTool.get(op.tool) ?? new Map();
      allowed.set(op.action, op);
      this.byTool.set(op.tool, allowed);
    }
  }

  listTools(): ToolDef[] {
    return [...this.byTool]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, actions]) => {
        const list = [...actions.values()].sort((a, b) => a.action.localeCompare(b.action));
        const readOnly = list.every((o) => o.method === "GET");
        const lines = list.map((o) => `- ${o.action}: ${o.summary}`);
        const resource = name.replace(/^gorelo_/, "").replace(/_/g, " ");
        return {
          name,
          description: [
            TOOL_BLURBS[name] ?? `Gorelo ${resource}. Call with {"action": ..., "params": {...}}.`,
            "Actions:",
            ...lines,
          ].join("\n"),
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", enum: list.map((o) => o.action) },
              params: {
                description:
                  "Parameters for the chosen action; the anyOf branch titled with the action name applies.",
                anyOf: list.map((o) => ({ title: o.action, ...paramsSchema(o) })),
              },
            },
            required: ["action"],
          },
          annotations: {
            readOnlyHint: readOnly,
            destructiveHint: name === "gorelo_admin",
            openWorldHint: true,
          },
        };
      });
  }

  private validator(op: OperationDef): ValidateFunction {
    const key = `${op.tool}.${op.action}`;
    let v = this.validators.get(key);
    if (!v) {
      v = this.ajv.compile(paramsSchema(op));
      this.validators.set(key, v);
    }
    return v;
  }

  async call(tool: string, rawArgs: unknown): Promise<{ text: string; isError: boolean }> {
    const args = (rawArgs ?? {}) as { action?: string; params?: Record<string, unknown> };
    const all = this.allByTool.get(tool);
    if (!all) return { text: `Unknown tool ${tool}.`, isError: true };
    const allowed = this.byTool.get(tool);
    const action = args.action ?? "";
    const known = all.get(action);
    if (!known) {
      const names = [...(allowed?.keys() ?? [])].sort().join(", ");
      return { text: `Unknown action "${action}" for ${tool}. Available: ${names}`, isError: true };
    }
    const op = allowed?.get(action);
    if (!op) {
      return {
        text: `${tool}.${action} requires the ${known.tier} tier; this install is ${this.tier}. Change "Access tier" in /plugin config for gorelo-plugin.`,
        isError: true,
      };
    }

    const params = args.params ?? {};
    const forced = Object.keys(op.forceBody ?? {}).filter((k) => k in ((params.body as object) ?? {}));
    if (forced.length) {
      return {
        text: `${forced.join(", ")} is set by the server for ${tool}.${action} and cannot be supplied.${tool === "gorelo_invoices" ? " Use gorelo_admin.invoices_create (full tier) to create an approved invoice." : ""}`,
        isError: true,
      };
    }
    const validate = this.validator(op);
    if (!validate(params)) {
      const detail = (validate.errors ?? [])
        .map(
          (e) =>
            `${e.instancePath || "params"} ${e.message}${
              e.params && "missingProperty" in e.params ? ` "${e.params.missingProperty}"` : ""
            }${e.params && "additionalProperty" in e.params ? ` "${e.params.additionalProperty}"` : ""}`,
        )
        .join("; ");
      return { text: `Invalid params for ${tool}.${action}: ${detail}`, isError: true };
    }

    const isWrite = op.method !== "GET";
    try {
      const result = await this.execute(op, params);
      if (isWrite) await appendAudit(this.deps.dataDir, { tool, action, params, status: 200 });
      return { text: renderResult(markUntrusted(result)), isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isWrite)
        await appendAudit(this.deps.dataDir, { tool, action, params, status: "error", error: message });
      return { text: message, isError: true };
    }
  }

  private async execute(op: OperationDef, params: Record<string, unknown>): Promise<unknown> {
    const { client, dataDir } = this.deps;
    const { body, limit, cursor, file_path, ...rest } = params as {
      body?: Record<string, unknown>;
      limit?: number;
      cursor?: string;
      file_path?: string;
    } & Record<string, unknown>;

    if (op.response === "binary") {
      const bytes = await client.binary(op, rest);
      const dir = join(dataDir, "downloads");
      await mkdir(dir, { recursive: true });
      const id = Object.values(rest).map(String).join("-") || "file";
      const path = join(
        dir,
        `${op.path.includes("invoices") ? "invoice" : op.tool.replace(/^gorelo_/, "")}-${id}.pdf`,
      );
      await writeFile(path, bytes);
      return { path, bytes: bytes.length };
    }

    if (op.body?.contentType === "multipart/form-data") {
      const form = new FormData();
      for (const [k, v] of Object.entries(body ?? {})) form.set(k, String(v));
      const data = await readFile(String(file_path));
      form.set("file", new Blob([data]), basename(String(file_path)));
      return (await client.multipart(op, form)).data;
    }

    const finalBody = op.forceBody ? { ...(body ?? {}), ...op.forceBody } : body;

    if (op.paginated) {
      const max = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const pageSize = Math.min(PAGE_SIZE, max);
      const out = await collectPages(
        (next) => client.json(op, rest, finalBody, next ?? cursor, pageSize),
        max,
      );
      return {
        items: out.items,
        count: out.items.length,
        ...(out.nextCursor ? { next_cursor: out.nextCursor } : {}),
        ...(out.notifications.length ? { notifications: out.notifications } : {}),
      };
    }

    const page = await client.json(op, rest, finalBody);
    return page.notifications.length ? { data: page.data, notifications: page.notifications } : page.data;
  }
}
