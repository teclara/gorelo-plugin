import type { JsonSchema } from "./types.js";

/**
 * tools/list is paid for in context on every session, so the schema shown to the model is a lean
 * copy of the one ajv validates against. It keeps every property name, type, format, enum, default
 * and required list; it shortens descriptions and drops what only matters to the validator.
 */
export const MAX_SUMMARY_CHARS = 120;
/** Description budget for action params and body fields. */
export const MAX_DESCRIPTION_CHARS = 120;
/** Description budget for anything nested deeper, such as the fields of an invoice line. */
export const MAX_NESTED_DESCRIPTION_CHARS = 60;

const NOISE = [
  /Backend column\s+`[^`]*`(?:,\s*NVarChar\(\d+\))?\.?/g,
  /,?\s*NVarChar\(\d+\)/g,
  /<\/?[a-z]+(?: [^>]*)?>/gi,
  /\*\*/g,
];

/** Whole sentences up to `max` chars; a first sentence that is too long is cut at a word boundary. */
export function shorten(text: string, max: number): string | undefined {
  let cleaned = text;
  for (const pattern of NOISE) cleaned = cleaned.replace(pattern, " ");
  cleaned = cleaned
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
  if (!cleaned) return undefined;
  if (cleaned.length <= max) return cleaned;
  let out = "";
  for (const sentence of cleaned.split(/(?<=[.!?])\s+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = cleaned.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[\s,;:]+$/, "")}…`;
}

/** An id filter whose description says only what the server instructions already say about every id filter. */
const ID_FILTER_BOILERPLATE = /^Comma-separated [\w ()-]+ ids( to include)?\.( Omit for every [\w ]+\.)?$/;

/** True when the property's name, type and format already say everything its description does. */
function selfExplanatory(
  name: string,
  schema: JsonSchema,
  plain: ReadonlySet<string>,
  depth: number,
): boolean {
  if (depth === 1 && plain.has(name)) return true;
  // Date-range filters such as UpdatedSince.
  if (schema.format === "date-time" && /(Since|Before|After)$/.test(name)) return true;
  return /Ids$/.test(name) && ID_FILTER_BOILERPLATE.test(String(schema.description));
}

function lean(schema: JsonSchema, depth: number, name: string, plain: ReadonlySet<string>): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    switch (key) {
      case "description": {
        // Depth 0 is the params object, and the body object is covered by the action summary.
        if (depth === 0 || (depth === 1 && name === "body")) break;
        if (selfExplanatory(name, schema, plain, depth)) break;
        const max = depth <= 2 ? MAX_DESCRIPTION_CHARS : MAX_NESTED_DESCRIPTION_CHARS;
        const text = shorten(String(value), max);
        if (text) out.description = text;
        break;
      }
      case "properties":
        out.properties = Object.fromEntries(
          Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [
            k,
            lean(v, depth + 1, k, plain),
          ]),
        );
        break;
      case "items":
        out.items = lean(value as JsonSchema, depth, name, plain);
        break;
      case "additionalProperties":
        // Unknown keys are still rejected by the validator; repeating that per object costs context.
        if (value !== false) out.additionalProperties = value;
        break;
      case "required":
        if ((value as unknown[]).length) out.required = value;
        break;
      case "anyOf":
      case "oneOf":
      case "allOf":
        out[key] = (value as JsonSchema[]).map((v) => lean(v, depth, name, plain));
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

/**
 * The advertised form of one action's params schema. `plain` names top-level params that need no
 * description at all: path ids, and limit/cursor, which the server instructions explain once.
 */
export function leanSchema(schema: JsonSchema, plain: Iterable<string> = []): JsonSchema {
  return lean(schema, 0, "params", new Set(plain));
}
