import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("maps region to base URL and defaults tier to read", () => {
    const cfg = loadConfig({ GORELO_API_KEY: "k", GORELO_REGION: "aue", GORELO_DATA_DIR: "/tmp/g" });
    expect(cfg).toEqual({
      apiKey: "k",
      baseUrl: "https://api.aue.gorelo.io",
      region: "aue",
      tier: "read",
      dataDir: "/tmp/g",
    });
  });

  it("defaults region to usw", () => {
    expect(loadConfig({ GORELO_API_KEY: "k" }).baseUrl).toBe("https://api.usw.gorelo.io");
  });

  it("treats unsubstituted ${user_config.*} placeholders as unset", () => {
    expect(() =>
      loadConfig({ GORELO_API_KEY: "${user_config.api_key}", GORELO_REGION: "${user_config.region}" }),
    ).toThrow(ConfigError);
    const cfg = loadConfig({ GORELO_API_KEY: "k", GORELO_ACCESS_TIER: "${user_config.access_tier}" });
    expect(cfg.tier).toBe("read");
  });

  it("rejects a missing key with a setup hint", () => {
    expect(() => loadConfig({})).toThrow(/API key is not set/);
  });

  it("rejects unknown region and tier", () => {
    expect(() => loadConfig({ GORELO_API_KEY: "k", GORELO_REGION: "eu" })).toThrow(/usw, aue/);
    expect(() => loadConfig({ GORELO_API_KEY: "k", GORELO_ACCESS_TIER: "admin" })).toThrow(
      /read, write, full/,
    );
  });

  it("honours GORELO_BASE_URL override and strips trailing slash", () => {
    expect(loadConfig({ GORELO_API_KEY: "k", GORELO_BASE_URL: "http://127.0.0.1:9999/" }).baseUrl).toBe(
      "http://127.0.0.1:9999",
    );
  });
});
