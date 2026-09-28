import { chmod, mkdir, mkdtemp, readFile, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendAudit, MAX_AUDIT_BYTES, redact } from "../src/audit.js";

describe("redact", () => {
  it("masks secret-looking keys at any depth", () => {
    expect(redact({ ApiKey: "k", nested: { password: "p", Token: "t", Name: "ok" } })).toEqual({
      ApiKey: "[redacted]",
      nested: { password: "[redacted]", Token: "[redacted]", Name: "ok" },
    });
  });
});

describe("appendAudit", () => {
  it("appends one JSON line per entry with a timestamp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gorelo-audit-"));
    await appendAudit(dir, {
      tool: "gorelo_tickets",
      action: "create",
      params: { Title: "x" },
      status: "ok",
    });
    await appendAudit(dir, {
      tool: "gorelo_admin",
      action: "tickets_delete",
      params: { ticketId: 1 },
      status: "error",
      error: "403",
    });
    const lines = (await readFile(join(dir, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ tool: "gorelo_tickets", action: "create", status: "ok" });
    expect(typeof lines[0].ts).toBe("string");
    expect(lines[1]).toMatchObject({ status: "error", error: "403" });
  });
});

// POSIX permission bits do not exist on Windows, where chmod is a best-effort no-op.
describe.skipIf(process.platform === "win32")("audit log permissions", () => {
  const entry = { tool: "gorelo_tickets", action: "create", params: {}, status: "error" as const };
  const mode = async (path: string) => (await stat(path)).mode & 0o777;

  it("creates the data directory as 0700 and the log as 0600", async () => {
    const dataDir = join(await mkdtemp(join(tmpdir(), "gorelo-audit-")), "nested", "data");
    await appendAudit(dataDir, entry);
    expect(await mode(dataDir)).toBe(0o700);
    expect(await mode(join(dataDir, "audit.jsonl"))).toBe(0o600);
  });

  it("tightens a directory and log that already exist with looser modes", async () => {
    const dataDir = join(await mkdtemp(join(tmpdir(), "gorelo-audit-")), "data");
    await mkdir(dataDir);
    await chmod(dataDir, 0o755);
    await writeFile(join(dataDir, "audit.jsonl"), '{"old":true}\n');
    await chmod(join(dataDir, "audit.jsonl"), 0o644);
    await appendAudit(dataDir, entry);
    expect(await mode(dataDir)).toBe(0o700);
    expect(await mode(join(dataDir, "audit.jsonl"))).toBe(0o600);
    const lines = (await readFile(join(dataDir, "audit.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("audit log rotation", () => {
  const entry = { tool: "gorelo_tickets", action: "create", params: {}, status: "ok" as const };

  it("limits the log to about 5 MB", () => {
    expect(MAX_AUDIT_BYTES).toBe(5 * 1024 * 1024);
  });

  it("keeps appending while the log is at or under the limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gorelo-audit-"));
    const log = join(dir, "audit.jsonl");
    await writeFile(log, "");
    await truncate(log, MAX_AUDIT_BYTES);
    await appendAudit(dir, entry);
    expect((await stat(log)).size).toBeGreaterThan(MAX_AUDIT_BYTES);
    await expect(stat(`${log}.1`)).rejects.toThrow(/ENOENT/);
  });

  it("renames a log over the limit to audit.jsonl.1, replacing the previous one, then appends", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gorelo-audit-"));
    const log = join(dir, "audit.jsonl");
    await writeFile(`${log}.1`, "previous rotation\n");
    await writeFile(log, '{"old":true}\n');
    await truncate(log, MAX_AUDIT_BYTES + 1);
    await appendAudit(dir, entry);
    const rotated = await readFile(`${log}.1`, "utf8");
    expect(rotated.length).toBe(MAX_AUDIT_BYTES + 1);
    expect(rotated.startsWith('{"old":true}\n')).toBe(true);
    const lines = (await readFile(log, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ action: "create", status: "ok" });
  });

  it.skipIf(process.platform === "win32")("keeps the rotated log owner-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gorelo-audit-"));
    const log = join(dir, "audit.jsonl");
    await writeFile(log, "");
    await chmod(log, 0o644);
    await truncate(log, MAX_AUDIT_BYTES + 1);
    await appendAudit(dir, entry);
    expect((await stat(`${log}.1`)).mode & 0o777).toBe(0o600);
  });
});
