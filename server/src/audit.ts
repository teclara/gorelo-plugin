import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface AuditEntry {
  tool: string;
  action: string;
  params: unknown;
  status: number | "error";
  error?: string;
}

const SECRET_KEY = /key|token|secret|password/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

export async function appendAudit(dataDir: string, entry: AuditEntry): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, params: redact(entry.params) });
  await appendFile(join(dataDir, "audit.jsonl"), `${line}\n`, "utf8");
}
