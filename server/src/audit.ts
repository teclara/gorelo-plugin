import { chmod, type FileHandle, mkdir, open, rename, stat } from "node:fs/promises";
import { join } from "node:path";

export interface AuditEntry {
  tool: string;
  action: string;
  params: unknown;
  /**
   * "ok": Gorelo accepted the call. "error": it was sent and failed (or may have timed out).
   * "denied": the server refused it before anything was sent; see `reason`.
   * The HTTP status code is deliberately not recorded, because the client does not report it.
   */
  status: "ok" | "error" | "denied";
  error?: string;
  /** Why a denied call was refused. */
  reason?: string;
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

/** Size past which audit.jsonl is rotated, so at most about twice this is kept on disk. */
export const MAX_AUDIT_BYTES = 5 * 1024 * 1024;

/**
 * Moves a log over MAX_AUDIT_BYTES to `<log>.1`, replacing the previous rotation. Best effort:
 * a log that cannot be rotated is still appended to, since losing the entry would be worse.
 */
async function rotate(log: string): Promise<void> {
  try {
    if ((await stat(log)).size <= MAX_AUDIT_BYTES) return;
    await tighten(log, PRIVATE_FILE_MODE);
    await rename(log, `${log}.1`);
  } catch {
    // No log yet, or it cannot be moved.
  }
}

export async function appendAudit(dataDir: string, entry: AuditEntry): Promise<void> {
  await ensurePrivateDir(dataDir);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, params: redact(entry.params) });
  const log = join(dataDir, "audit.jsonl");
  await rotate(log);
  const handle = await open(log, "a", PRIVATE_FILE_MODE);
  try {
    await tighten(handle, PRIVATE_FILE_MODE);
    await handle.appendFile(`${line}\n`, "utf8");
  } finally {
    await handle.close();
  }
}
