import { chmod, type FileHandle, mkdir, open } from "node:fs/promises";
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

/** Owner-only modes: the log and downloads hold request bodies, ticket text and client data. */
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** chmod that tolerates platforms and filesystems without POSIX permissions (e.g. Windows). */
async function tighten(target: string | FileHandle, mode: number): Promise<void> {
  try {
    await (typeof target === "string" ? chmod(target, mode) : target.chmod(mode));
  } catch {
    // Best effort: the write itself still matters more than the mode.
  }
}

/** Creates `dir` readable by the owner only, tightening it when it already exists looser. */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await tighten(dir, PRIVATE_DIR_MODE);
}

export async function appendAudit(dataDir: string, entry: AuditEntry): Promise<void> {
  await ensurePrivateDir(dataDir);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, params: redact(entry.params) });
  const handle = await open(join(dataDir, "audit.jsonl"), "a", PRIVATE_FILE_MODE);
  try {
    await tighten(handle, PRIVATE_FILE_MODE);
    await handle.appendFile(`${line}\n`, "utf8");
  } finally {
    await handle.close();
  }
}
