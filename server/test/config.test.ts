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

  it.each([
    ["https://api.usw.gorelo.io", "https://api.usw.gorelo.io"],
    ["https://API.EUW.Gorelo.io/", "https://API.EUW.Gorelo.io"],
    ["https://gorelo.io/api//", "https://gorelo.io/api"],
    ["http://localhost:8080", "http://localhost:8080"],
    ["https://localhost", "https://localhost"],
    ["http://[::1]:3000/", "http://[::1]:3000"],
  ])("accepts base URL %s", (url, expected) => {
    expect(loadConfig({ GORELO_API_KEY: "k", GORELO_BASE_URL: url }).baseUrl).toBe(expected);
  });

  it.each([
    ["not a url", /not a valid URL/],
    ["api.usw.gorelo.io", /not a valid URL/],
    ["http://api.usw.gorelo.io", /must use https/],
    ["ftp://localhost/", /must use https/],
    ["file:///etc/passwd", /must use https/],
    ["https://evil.example", /gorelo\.io/],
    ["https://gorelo.io.evil.example", /gorelo\.io/],
    ["https://evilgorelo.io", /gorelo\.io/],
    ["https://api.gorelo.io@evil.example/", /gorelo\.io/],
    ["https://user:pass@api.usw.gorelo.io", /credentials/],
    ["http://127.0.0.2:9999", /must use https/],
    ["http://localhost.evil.example", /must use https/],
    ["https://192.168.1.10", /gorelo\.io/],
  ])("rejects base URL %s so the API key is not sent there", (url, message) => {
    const load = () => loadConfig({ GORELO_API_KEY: "k", GORELO_BASE_URL: url });
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(message);
    expect(load).toThrow(/GORELO_BASE_URL/);
  });
});
