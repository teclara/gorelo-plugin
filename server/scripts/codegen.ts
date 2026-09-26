import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { emitOperations, MAX_TOOL_SCHEMA_CHARS, sizeReport } from "./codegen/emit.js";
import { type OpenApiSpec, planOperations } from "./codegen/plan.js";

const DEFAULT_SPEC = "https://api.usw.gorelo.io/swagger/v1.0/swagger.json";
const DEFAULT_OUT = "server/generated/operations.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadSpec(source: string): Promise<OpenApiSpec & { info?: { version?: string } }> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Fetching ${source} failed: ${res.status}`);
    return (await res.json()) as OpenApiSpec;
  }
  return JSON.parse(await readFile(resolve(source), "utf8")) as OpenApiSpec;
}

const source = arg("--spec") ?? DEFAULT_SPEC;
const outPath = arg("--out") ?? DEFAULT_OUT;
const spec = await loadSpec(source);
const ops = planOperations(spec);

console.log(`Planned ${ops.length} actions from ${Object.keys(spec.paths).length} paths (${source})`);
const report = sizeReport(ops);
for (const row of report) console.log(`  ${row.tool.padEnd(28)} ${row.chars.toLocaleString()} chars`);
const tooBig = report.filter((r) => r.chars > MAX_TOOL_SCHEMA_CHARS);
if (tooBig.length) {
  console.error(`Tool schema over ${MAX_TOOL_SCHEMA_CHARS} chars: ${tooBig.map((r) => r.tool).join(", ")}`);
  process.exit(1);
}

await writeFile(outPath, emitOperations(ops, spec.info?.version ?? "unknown"));
console.log(`Wrote ${outPath}`);
