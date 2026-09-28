import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendAudit, redact } from "../src/audit.js";

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
