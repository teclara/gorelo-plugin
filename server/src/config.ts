import { homedir } from "node:os";
import { join } from "node:path";
import type { Tier } from "./types.js";

export const REGIONS = {
  usw: "https://api.usw.gorelo.io",
  aue: "https://api.aue.gorelo.io",
} as const;

export interface Config {
  apiKey: string;
  baseUrl: string;
  region: keyof typeof REGIONS;
  tier: Tier;
  dataDir: string;
}

export class ConfigError extends Error {}

const SETUP_HINT = "Run /plugin, select gorelo-plugin, and configure it.";

/** Returns undefined for empty values and for placeholders Claude Code left unsubstituted. */
function read(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  if (!value || value.startsWith("${")) return undefined;
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const apiKey = read(env, "GORELO_API_KEY");
  if (!apiKey) throw new ConfigError(`Gorelo API key is not set. ${SETUP_HINT}`);

  const region = read(env, "GORELO_REGION") ?? "usw";
  if (!(region in REGIONS)) {
    throw new ConfigError(`GORELO_REGION must be one of usw, aue (got "${region}"). ${SETUP_HINT}`);
  }

  const tier = read(env, "GORELO_ACCESS_TIER") ?? "read";
  if (tier !== "read" && tier !== "write" && tier !== "full") {
    throw new ConfigError(`Access tier must be one of read, write, full (got "${tier}"). ${SETUP_HINT}`);
  }

  const baseUrl = (read(env, "GORELO_BASE_URL") ?? REGIONS[region as keyof typeof REGIONS]).replace(
    /\/+$/,
    "",
  );
  const dataDir = read(env, "GORELO_DATA_DIR") ?? join(homedir(), ".gorelo-plugin");

  return { apiKey, baseUrl, region: region as keyof typeof REGIONS, tier, dataDir };
}
