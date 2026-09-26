import { describe, expect, it } from "vitest";
import { GoreloClient, GoreloError } from "../src/http.js";
import type { OperationDef } from "../src/types.js";

const listTickets: OperationDef = {
  operationId: "get_v1_tickets",
  method: "GET",
  path: "/v1/tickets",
  tool: "gorelo_tickets",
  action: "list",
  tier: "read",
  summary: "",
  params: [{ name: "StatusIds", in: "query", required: false, schema: { type: "string" } }],
  response: "json",
  paginated: true,
};
const getComment: OperationDef = {
  ...listTickets,
  operationId: "get_c",
  path: "/v1/tickets/{ticketId}/comments/{commentId}",
  action: "get_comments",
  params: [
    { name: "ticketId", in: "path", required: true, schema: { type: "integer" } },
    { name: "commentId", in: "path", required: true, schema: { type: "integer" } },
  ],
  paginated: false,
};

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  };
  return { calls, fetchImpl };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const client = (responses: Response[]) => {
  const f = fakeFetch(responses);
  const sleeps: number[] = [];
  const c = new GoreloClient({
    apiKey: "secret",
    baseUrl: "https://api.usw.gorelo.io",
    fetchImpl: f.fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { c, calls: f.calls, sleeps };
};

describe("buildUrl", () => {
  const { c } = client([]);
  it("substitutes and encodes path params, adds query and paging", () => {
    expect(c.buildUrl(getComment, { ticketId: 5, commentId: "a b?" })).toBe(
      "https://api.usw.gorelo.io/v1/tickets/5/comments/a%20b%3F",
    );
    expect(c.buildUrl(listTickets, { StatusIds: "1,2" }, "abc", 200)).toBe(
      "https://api.usw.gorelo.io/v1/tickets?StatusIds=1%2C2&Cursor=abc&PageSize=200",
    );
  });
  it("joins array query values with commas and skips undefined/null", () => {
    expect(c.buildUrl(listTickets, { StatusIds: [1, 2], Other: null })).toBe(
      "https://api.usw.gorelo.io/v1/tickets?StatusIds=1%2C2",
    );
  });
  it.each([".", "..", "a/b", "a%2Fb", "%2e%2e", "..%2F..%2Fclients", "a\\b"])(
    "rejects path traversal value %s",
    (value) => {
      expect(() => c.buildUrl(getComment, { ticketId: 5, commentId: value })).toThrow(/commentId/);
    },
  );
  it("throws when a path param is missing", () => {
    expect(() => c.buildUrl(getComment, { ticketId: 5 })).toThrow(/commentId/);
  });
});

describe("json", () => {
  it("sends the API key and unwraps the envelope", async () => {
    const { c, calls } = client([
      json(200, {
        IsSuccess: true,
        Data: [{ Id: 1 }],
        DataContext: { Pagination: { NextCursor: "n1", HasMore: true } },
        Notifications: [],
      }),
    ]);
    const page = await c.json(listTickets, {});
    expect(page).toEqual({ data: [{ Id: 1 }], nextCursor: "n1", hasMore: true, notifications: [] });
    expect((calls[0]!.init.headers as Record<string, string>)["X-API-Key"]).toBe("secret");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("sends JSON bodies", async () => {
    const { c, calls } = client([json(200, { IsSuccess: true, Data: { Id: 9 } })]);
    await c.json({ ...listTickets, method: "POST" }, {}, { Title: "x" });
    expect(calls[0]!.init.body).toBe('{"Title":"x"}');
    expect((calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("explains 401 with base URL and region hint", async () => {
    const { c } = client([json(401, {})]);
    await expect(c.json(listTickets, {})).rejects.toThrow(/API key.*region.*api\.usw\.gorelo\.io/s);
  });

  it("explains 403 as a scope problem naming the action", async () => {
    const { c } = client([json(403, {})]);
    await expect(c.json(listTickets, {})).rejects.toThrow(/scope.*gorelo_tickets\.list/s);
  });

  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const { c, sleeps } = client([
      json(429, {}, { "retry-after": "2" }),
      json(429, {}),
      json(200, { IsSuccess: true, Data: [] }),
    ]);
    await c.json(listTickets, {});
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("gives up after 3 retries on 429", async () => {
    const { c, calls } = client([json(429, {}), json(429, {}), json(429, {}), json(429, {})]);
    await expect(c.json(listTickets, {})).rejects.toThrow(/rate limit/i);
    expect(calls).toHaveLength(4);
  });

  it("surfaces Notifications on other errors", async () => {
    const { c } = client([
      json(400, {
        IsSuccess: false,
        Notifications: [{ Code: "070101", Message: "SortBy invalid", ActionHint: "Use updatedOn" }],
      }),
    ]);
    const err = await c.json(listTickets, {}).catch((e) => e);
    expect(err).toBeInstanceOf(GoreloError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("070101 SortBy invalid (Use updatedOn)");
  });

  it("treats IsSuccess:false on 200 as an error", async () => {
    const { c } = client([json(200, { IsSuccess: false, Notifications: [{ Message: "nope" }] })]);
    await expect(c.json(listTickets, {})).rejects.toThrow(/nope/);
  });

  it("rejects 200 with non-JSON body", async () => {
    const { c } = client([new Response("<html>oops</html>", { status: 200 })]);
    const err = await c.json(listTickets, {}).catch((e) => e);
    expect(err).toBeInstanceOf(GoreloError);
    expect(err.message).toMatch(/non-JSON/);
    expect(err.status).toBe(200);
  });
});

describe("binary", () => {
  it("returns bytes", async () => {
    const { c } = client([new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })]);
    expect(
      Array.from(await c.binary({ ...getComment, response: "binary" }, { ticketId: 1, commentId: 2 })),
    ).toEqual([37, 80, 68, 70]);
  });
});

describe("timeouts", () => {
  const post: OperationDef = { ...listTickets, method: "POST", action: "create", paginated: false };

  it.each(["TimeoutError", "AbortError"])(
    "turns a %s into a GoreloError that says a write may have applied",
    async (errName) => {
      const c = new GoreloClient({
        apiKey: "k",
        baseUrl: "https://x.test",
        fetchImpl: async () => {
          throw new DOMException("The operation was aborted due to timeout", errName);
        },
      });
      const err = await c.json(post, {}, { Title: "x" }).catch((e) => e);
      expect(err).toBeInstanceOf(GoreloError);
      expect(err.message).toMatch(/timed out/);
      expect(err.message).toContain("gorelo_tickets.create");
      expect(err.message).toMatch(/may or may not have applied/);
      expect(err.message).toMatch(/read before retrying/);
    },
  );

  it("aborts a request that outlives the timeout", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const c = new GoreloClient({
      apiKey: "k",
      baseUrl: "https://x.test",
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          signals.push(init.signal);
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    await expect(c.json(listTickets, {})).rejects.toThrow(/timed out/);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("passes other network errors through unchanged", async () => {
    const c = new GoreloClient({
      apiKey: "k",
      baseUrl: "https://x.test",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(c.json(listTickets, {})).rejects.toThrow("fetch failed");
  });
});
