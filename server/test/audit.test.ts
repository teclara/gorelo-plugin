import { mkdtemp, readFile } from "node:fs/promises";
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
    await appendAudit(dir, { tool: "gorelo_tickets", action: "create", params: { Title: "x" }, status: 200 });
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
    expect(lines[0]).toMatchObject({ tool: "gorelo_tickets", action: "create", status: 200 });
    expect(typeof lines[0].ts).toBe("string");
    expect(lines[1]).toMatchObject({ status: "error", error: "403" });
  });
});
