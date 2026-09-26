import { OPERATIONS } from "../generated/operations.js";
import { loadConfig } from "../src/config.js";
import { GoreloClient } from "../src/http.js";
import { Registry } from "../src/registry.js";

const cfg = { ...loadConfig(), tier: "read" as const };
const registry = new Registry(OPERATIONS, "read", {
  client: new GoreloClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }),
  dataDir: cfg.dataDir,
});

const probes: [string, string][] = [
  ["gorelo_organization", "list_users"],
  ["gorelo_clients", "list"],
  ["gorelo_tickets", "list"],
  ["gorelo_tickets", "list_statuses"],
  ["gorelo_assets", "list_agents"],
  ["gorelo_uptime", "list"],
];

let failed = 0;
for (const [tool, action] of probes) {
  const params = OPERATIONS.find((o) => o.tool === tool && o.action === action)?.paginated
    ? { limit: 1 }
    : {};
  const res = await registry.call(tool, { action, params });
  const status = res.isError ? (/\(403\)/.test(res.text) ? "SKIP (403 scope)" : "FAIL") : "OK";
  if (status === "FAIL") failed++;
  console.log(`${status.padEnd(16)} ${tool}.${action}${res.isError ? `  ${res.text.slice(0, 200)}` : ""}`);
}
process.exit(failed ? 1 : 0);
