import { mkdtemp } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let http: HttpServer;
let baseUrl: string;
const seen: { method: string; url: string; key: string | undefined }[] = [];

beforeAll(async () => {
  http = createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url!, key: req.headers["x-api-key"] as string | undefined });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        IsSuccess: true,
        Data: [{ Id: 1, Name: "Acme" }],
        DataContext: { Pagination: { HasMore: false } },
      }),
    );
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => http.close(() => r())));

async function connect(env: Record<string, string>) {
  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["server/dist/index.js"],
    env: {
      PATH: process.env.PATH ?? "",
      GORELO_DATA_DIR: await mkdtemp(join(tmpdir(), "gorelo-int-")),
      ...env,
    },
  });
  await client.connect(transport);
  return client;
}

describe("stdio server", () => {
  it("lists tier-filtered tools and calls through to Gorelo", async () => {
    const client = await connect({
      GORELO_API_KEY: "int-key",
      GORELO_BASE_URL: baseUrl,
      GORELO_ACCESS_TIER: "read",
    });
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("gorelo_clients");
    expect(names).toContain("gorelo_tickets");
    expect(names).not.toContain("gorelo_admin");

    const res = await client.callTool({
      name: "gorelo_clients",
      arguments: { action: "list", params: { limit: 5 } },
    });
    expect(res.isError).toBeFalsy();
    expect((res.content as { text: string }[])[0]!.text).toContain("Acme");
    expect(seen.at(-1)).toMatchObject({ method: "GET", key: "int-key" });
    expect(seen.at(-1)!.url).toMatch(/^\/v1\/clients\?PageSize=5$/);
    await client.close();
  });

  it("full tier exposes gorelo_admin", async () => {
    const client = await connect({
      GORELO_API_KEY: "k",
      GORELO_BASE_URL: baseUrl,
      GORELO_ACCESS_TIER: "full",
    });
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("gorelo_admin");
    await client.close();
  });

  it("starts without config and explains how to set it up", async () => {
    const client = await connect({ GORELO_API_KEY: "${user_config.api_key}" });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["gorelo_setup"]);
    const res = await client.callTool({ name: "gorelo_setup", arguments: {} });
    expect((res.content as { text: string }[])[0]!.text).toMatch(/API key is not set/);
    await client.close();
  });
});
