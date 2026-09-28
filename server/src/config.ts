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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The API key is sent to the base URL, so an override must be Gorelo over https.
 * Loopback is the one exception, over http or https, for local testing.
 */
function checkBaseUrl(value: string): void {
  const hint = "Unset it to use the region's default.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`GORELO_BASE_URL is not a valid URL (got "${value}"). ${hint}`);
  }
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(host) && (url.protocol === "http:" || url.protocol === "https:");
  if (!loopback && url.protocol !== "https:") {
    throw new ConfigError(`GORELO_BASE_URL must use https (got "${value}"). ${hint}`);
  }
  if (!loopback && host !== "gorelo.io" && !host.endsWith(".gorelo.io")) {
    throw new ConfigError(
      `GORELO_BASE_URL must be on gorelo.io or a subdomain of it (got host "${host}"); the API key is not sent anywhere else. ${hint}`,
    );
  }
  if (url.username || url.password) {
    throw new ConfigError(`GORELO_BASE_URL must not contain credentials. ${hint}`);
  }
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

  const override = read(env, "GORELO_BASE_URL");
  if (override) checkBaseUrl(override);
  const baseUrl = (override ?? REGIONS[region as keyof typeof REGIONS]).replace(/\/+$/, "");
  const dataDir = read(env, "GORELO_DATA_DIR") ?? join(homedir(), ".gorelo-plugin");

  return { apiKey, baseUrl, region: region as keyof typeof REGIONS, tier, dataDir };
}
