import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planOperations } from "../scripts/codegen/plan.js";
import { GoreloClient } from "../src/http.js";
import { Registry } from "../src/registry.js";
import type { Tier } from "../src/types.js";
import spec from "./fixtures/mini-spec.json" with { type: "json" };

const ops = planOperations(spec as never);

async function setup(tier: Tier, responses: Response[] = []) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = new GoreloClient({
    apiKey: "k",
    baseUrl: "https://x.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const r = responses.shift();
      if (!r) throw new Error("unexpected HTTP call");
      return r;
    },
    sleep: async () => {},
  });
  const dataDir = await mkdtemp(join(tmpdir(), "gorelo-reg-"));
  return { reg: new Registry(ops, tier, { client, dataDir }), calls, dataDir };
}
const ok = (data: unknown, next?: string) =>
  new Response(
    JSON.stringify({
      IsSuccess: true,
      Data: data,
      DataContext: { Pagination: { NextCursor: next ?? null, HasMore: Boolean(next) } },
    }),
    { status: 200 },
  );

describe("listTools", () => {
  it("read tier exposes only GET actions and no admin tool", async () => {
    const { reg } = await setup("read");
    const tools = reg.listTools();
    expect(tools.map((t) => t.name)).not.toContain("gorelo_admin");
    const tickets = tools.find((t) => t.name === "gorelo_tickets")!;
    const actions = (tickets.inputSchema.properties as any).action.enum;
    expect(actions).toEqual(["get", "list", "list_comments", "list_statuses"]);
    expect(tickets.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
  });

  it("write tier adds write actions but still no admin tool", async () => {
    const { reg } = await setup("write");
    const tickets = reg.listTools().find((t) => t.name === "gorelo_tickets")!;
    expect((tickets.inputSchema.properties as any).action.enum).toContain("create");
    expect(tickets.annotations.readOnlyHint).toBe(false);
    expect(reg.listTools().map((t) => t.name)).not.toContain("gorelo_admin");
  });

  it("full tier adds gorelo_admin marked destructive", async () => {
    const { reg } = await setup("full");
    const admin = reg.listTools().find((t) => t.name === "gorelo_admin")!;
    expect(admin.annotations.destructiveHint).toBe(true);
    expect((admin.inputSchema.properties as any).action.enum).toEqual([
      "invoices_create",
      "items_update",
      "tickets_delete",
    ]);
  });

  it("never uses oneOf/anyOf/allOf at the top level and types params per action", async () => {
    const { reg } = await setup("full");
    for (const t of reg.listTools()) {
      expect(t.inputSchema.oneOf).toBeUndefined();
      expect(t.inputSchema.anyOf).toBeUndefined();
      expect(t.inputSchema.allOf).toBeUndefined();
      expect(t.inputSchema.required).toEqual(["action"]);
    }
    const tickets = reg.listTools().find((t) => t.name === "gorelo_tickets")!;
    const branches = (tickets.inputSchema.properties as any).params.anyOf as { title: string }[];
    expect(branches.map((b) => b.title)).toContain("list_comments");
    expect(tickets.description).toContain("list_comments");
  });
});

describe("call", () => {
  it("rejects unknown tools, unknown actions and tier-forbidden actions without HTTP", async () => {
    const { reg, calls } = await setup("read");
    expect((await reg.call("gorelo_nope", { action: "list" })).text).toMatch(/Unknown tool/);
    expect((await reg.call("gorelo_tickets", { action: "explode" })).text).toMatch(
      /Unknown action.*list_comments/s,
    );
    const forbidden = await reg.call("gorelo_tickets", {
      action: "create",
      params: { body: { Title: "x", ClientId: 1 } },
    });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.text).toMatch(/requires the write tier/);
    expect(
      await reg.call("gorelo_admin", { action: "tickets_delete", params: { ticketId: 1 } }),
    ).toMatchObject({ isError: true });
    expect(calls).toHaveLength(0);
  });

  it("validates params with the field name before any HTTP call", async () => {
    const { reg, calls } = await setup("write");
    const missing = await reg.call("gorelo_tickets", { action: "get", params: {} });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/ticketId/);
    const wrongType = await reg.call("gorelo_tickets", {
      action: "create",
      params: { body: { Title: 5, ClientId: 1 } },
    });
    expect(wrongType.text).toMatch(/Title/);
    expect(calls).toHaveLength(0);
  });

  it("paginates list actions to limit and wraps untrusted fields", async () => {
    const { reg, calls } = await setup("read", [
      ok(
        [
          { Id: 1, Title: "a" },
          { Id: 2, Title: "b" },
        ],
        "c1",
      ),
    ]);
    const res = await reg.call("gorelo_tickets", { action: "list", params: { StatusIds: "1", limit: 2 } });
    expect(calls[0]!.url).toBe("https://x.test/v1/tickets?StatusIds=1&PageSize=2");
    const body = JSON.parse(res.text);
    expect(body.items).toEqual([
      { Id: 1, Title: "<untrusted_content>a</untrusted_content>" },
      { Id: 2, Title: "<untrusted_content>b</untrusted_content>" },
    ]);
    expect(body.next_cursor).toBe("c1");
  });

  it("clamps limit to 500 and resumes from a supplied cursor", async () => {
    const { reg, calls } = await setup("read", [ok([])]);
    await reg.call("gorelo_tickets", { action: "list", params: { limit: 9999, cursor: "resume" } });
    expect(calls[0]!.url).toBe("https://x.test/v1/tickets?Cursor=resume&PageSize=200");
  });

  it("forces StatusId=1 on write-tier invoice create and audits the call", async () => {
    const { reg, calls, dataDir } = await setup("write", [ok({ Id: 7 })]);
    const res = await reg.call("gorelo_invoices", {
      action: "create",
      params: { body: { ClientId: 3, LineItems: [{ Name: "x" }] } },
    });
    expect(res.isError).toBe(false);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      ClientId: 3,
      LineItems: [{ Name: "x" }],
      StatusId: 1,
    });
    const audit = (await readFile(join(dataDir, "audit.jsonl"), "utf8")).trim();
    expect(JSON.parse(audit)).toMatchObject({ tool: "gorelo_invoices", action: "create", status: 200 });
  });

  it("rejects a caller-supplied StatusId on draft invoice create", async () => {
    const { reg, calls } = await setup("write");
    const res = await reg.call("gorelo_invoices", {
      action: "create",
      params: { body: { ClientId: 3, LineItems: [{ Name: "x" }], StatusId: 5 } },
    });
    // forceBody would override it anyway; reject loudly so Claude learns drafts are enforced.
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/StatusId/);
    expect(calls).toHaveLength(0);
  });

  it("saves binary responses to downloads and returns the path", async () => {
    const { reg, dataDir } = await setup("read", [
      new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }),
    ]);
    const res = await reg.call("gorelo_invoices", { action: "pdf", params: { invoiceId: 42 } });
    const { path } = JSON.parse(res.text);
    expect(path).toBe(join(dataDir, "downloads", "invoice-42.pdf"));
    expect(Array.from(await readFile(path))).toEqual([37, 80, 68, 70]);
  });

  it("uploads a local file as multipart", async () => {
    const { reg, calls, dataDir } = await setup("write", [ok({ Name: "a.txt", Url: "https://cdn/a.txt" })]);
    const file = join(dataDir, "a.txt");
    await (await import("node:fs/promises")).writeFile(file, "hello");
    const res = await reg.call("gorelo_attachments", {
      action: "upload",
      params: {
        file_path: file,
        body: { itemType: "ticket", itemId: "00000000-0000-0000-0000-000000000001" },
      },
    });
    expect(res.isError).toBe(false);
    const form = calls[0]!.init.body as FormData;
    expect(form.get("itemType")).toBe("ticket");
    expect((form.get("file") as File).name).toBe("a.txt");
  });

  it("returns Gorelo errors as tool errors and audits failed writes", async () => {
    const { reg, dataDir } = await setup("write", [new Response("{}", { status: 403 })]);
    const res = await reg.call("gorelo_tickets", {
      action: "create",
      params: { body: { Title: "x", ClientId: 1 } },
    });
    expect(res).toMatchObject({ isError: true });
    expect(res.text).toMatch(/scope/);
    expect(await readFile(join(dataDir, "audit.jsonl"), "utf8")).toContain('"status":"error"');
  });
});
