import type { JsonSchema } from "../../src/types.js";

export const MAX_REF_DEPTH = 6;
const KEEP_FORMATS = new Set(["date-time", "date", "uuid", "email", "uri"]);
const DROP_KEYS = new Set([
  "nullable",
  "readOnly",
  "writeOnly",
  "example",
  "xml",
  "discriminator",
  "deprecated",
]);

export function cleanDescription(text: string): string | undefined {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/Backend column `[^`]*`\.?/g, "")
    .replace(/Gorelo_PublicAPI(?:\.\w+)*\.(\w+)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > 400 ? cleaned.slice(0, 400) : cleaned;
}

/** Inline $refs, convert OpenAPI 3.0 nullable to JSON Schema, and trim noise for LLM consumption. */
export function normalizeSchema(
  schema: unknown,
  components: Record<string, unknown>,
  seen: string[] = [],
): JsonSchema {
  if (!schema || typeof schema !== "object") return {};
  const s = schema as Record<string, unknown>;

  if (typeof s.$ref === "string") {
    const name = s.$ref.replace("#/components/schemas/", "");
    if (seen.includes(name) || seen.length >= MAX_REF_DEPTH) {
      return { type: "object", description: `${name} (recursive; nested fields omitted)` };
    }
    const target = components[name];
    if (!target) throw new Error(`Unresolved $ref ${s.$ref}`);
    return normalizeSchema(target, components, [...seen, name]);
  }

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(s)) {
    if (DROP_KEYS.has(key)) continue;
    switch (key) {
      case "description": {
        const d = cleanDescription(String(value));
        if (d) out.description = d;
        break;
      }
      case "properties":
        out.properties = Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [
            k,
            normalizeSchema(v, components, seen),
          ]),
        );
        break;
      case "items":
        out.items = normalizeSchema(value, components, seen);
        break;
      case "additionalProperties":
        out.additionalProperties =
          typeof value === "object" ? normalizeSchema(value, components, seen) : value;
        break;
      case "allOf":
      case "oneOf":
      case "anyOf":
        out[key] = (value as unknown[]).map((v) => normalizeSchema(v, components, seen));
        break;
      case "format":
        if (KEEP_FORMATS.has(String(value))) out.format = value;
        break;
      default:
        out[key] = value;
    }
  }

  if (s.nullable === true) {
    if (typeof out.type === "string") out.type = [out.type, "null"];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  return out;
}
