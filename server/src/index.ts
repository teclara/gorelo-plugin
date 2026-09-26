import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { OPERATIONS, SPEC_VERSION } from "../generated/operations.js";
import { ConfigError, loadConfig } from "./config.js";
import { GoreloClient } from "./http.js";
import { INSTRUCTIONS } from "./instructions.js";
import { Registry } from "./registry.js";

const VERSION = "0.1.0";

export function createServer(env: Record<string, string | undefined> = process.env): Server {
  const server = new Server(
    { name: "gorelo", version: VERSION },
    { capabilities: { tools: {} }, instructions: `${INSTRUCTIONS}\n(Gorelo API spec ${SPEC_VERSION})` },
  );

  let registry: Registry | undefined;
  let setupError: string | undefined;
  try {
    const cfg = loadConfig(env);
    registry = new Registry(OPERATIONS, cfg.tier, {
      client: new GoreloClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }),
      dataDir: cfg.dataDir,
    });
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    setupError = err.message;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (registry) return { tools: registry.listTools() };
    return {
      tools: [
        {
          name: "gorelo_setup",
          description: "The Gorelo plugin is not configured. Call this to see what is missing.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (!registry)
      return { content: [{ type: "text", text: setupError ?? "Not configured." }], isError: true };
    const { text, isError } = await registry.call(req.params.name, req.params.arguments);
    return { content: [{ type: "text", text }], isError };
  });

  return server;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  await createServer().connect(new StdioServerTransport());
}
