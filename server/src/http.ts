import { wrapUntrusted } from "./shape.js";
import type { OperationDef } from "./types.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface Notification {
  Code?: string;
  Message?: string;
  PropertyName?: string | null;
  ActionHint?: string | null;
}

export interface Page {
  data: unknown;
  nextCursor?: string;
  hasMore: boolean;
  notifications: Notification[];
}

export class GoreloError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly notifications: Notification[] = [],
  ) {
    super(message);
  }
}

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 30000;
export const REQUEST_TIMEOUT_MS = 30000;

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The body's Notifications, or none when the body is not an object or they are not a list. */
function notificationsOf(body: unknown): Notification[] {
  const list = isRecord(body) ? body.Notifications : undefined;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

function formatNotifications(list: Notification[]): string {
  return list
    .map((n) => [n.Code, n.Message].filter(Boolean).join(" ") + (n.ActionHint ? ` (${n.ActionHint})` : ""))
    .filter(Boolean)
    .join("; ");
}

/** The error's message plus its cause's, which is where fetch puts the reason (DNS, reset, refused). */
function describeCause(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : err.cause ? String(err.cause) : "";
  return [err.message || err.name, cause].filter(Boolean).join(": ").replace(/\.+$/, "");
}

/** Text from the API goes into an error message wrapped, so the model treats it as data. */
function apiText(text: string): string {
  return text ? wrapUntrusted(text) : "no details";
}

export class GoreloClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl: string;
      fetchImpl?: FetchLike;
      sleep?: (ms: number) => Promise<void>;
      /** Per-request timeout, covering the response body too. */
      timeoutMs?: number;
    },
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /**
   * Runs one request (including reading its body) and turns a timeout or network failure into an
   * actionable error. URL building happens outside, so parameter errors keep their own messages.
   */
  private async guarded<T>(op: OperationDef, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof GoreloError) throw err;
      const where = `${op.tool}.${op.action} (${op.method} ${op.path})`;
      const advice =
        op.method !== "GET"
          ? " The write may or may not have applied: check with a read before retrying, and never repeat it blindly."
          : isAbort(err)
            ? " Retry, or narrow the request with filters or a smaller limit."
            : " Check the network connection and the region, then retry.";
      if (isAbort(err)) {
        throw new GoreloError(
          `Gorelo request timed out after ${Math.round(this.timeoutMs / 1000)}s for ${where}.${advice}`,
          0,
        );
      }
      throw new GoreloError(`Gorelo request failed for ${where}: ${describeCause(err)}.${advice}`, 0);
    }
  }

  buildUrl(op: OperationDef, params: Record<string, unknown>, cursor?: string, pageSize?: number): string {
    let path = op.path;
    for (const p of op.params.filter((x) => x.in === "path")) {
      const value = params[p.name];
      if (value === undefined || value === null || value === "")
        throw new Error(`Missing required path parameter "${p.name}"`);
      const raw = String(value);
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        // malformed escapes are sent encoded as-is
      }
      if (decoded === "." || decoded === ".." || /[/\\]/.test(decoded)) {
        throw new Error(
          `Invalid path parameter "${p.name}": ${JSON.stringify(raw)} is not an id ("." / ".." and slashes are not allowed).`,
        );
      }
      path = path.replace(`{${p.name}}`, encodeURIComponent(raw));
    }
    const query = new URLSearchParams();
    for (const p of op.params.filter((x) => x.in === "query")) {
      const value = params[p.name];
      if (value === undefined || value === null) continue;
      query.set(p.name, Array.isArray(value) ? value.join(",") : String(value));
    }
    if (cursor) query.set("Cursor", cursor);
    if (pageSize) query.set("PageSize", String(pageSize));
    const qs = query.toString();
    return `${this.opts.baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  private async send(op: OperationDef, url: string, init: RequestInit): Promise<Response> {
    const headers = {
      "X-API-Key": this.opts.apiKey,
      Accept: "application/json",
      ...(init.headers as Record<string, string>),
    };
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        ...init,
        method: op.method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status !== 429) return res;
      if (attempt >= MAX_RETRIES) {
        throw new GoreloError(
          `Gorelo rate limit hit (429) after ${MAX_RETRIES} retries. Wait a minute and retry, or narrow the request with filters.`,
          429,
        );
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await this.sleep(Math.min(wait, MAX_WAIT_MS));
    }
  }

  private async fail(op: OperationDef, res: Response): Promise<never> {
    let notifications: Notification[] = [];
    let text = "";
    try {
      text = await res.text();
      notifications = notificationsOf(JSON.parse(text));
    } catch {
      // non-JSON error body; fall back to the raw text below
    }
    const name = `${op.tool}.${op.action}`;
    if (res.status === 401) {
      throw new GoreloError(
        `Gorelo rejected the API key (401). Check the key and the region (current base URL: ${this.opts.baseUrl}). Rerun /plugin to reconfigure gorelo-plugin.`,
        401,
        notifications,
      );
    }
    if (res.status === 403) {
      throw new GoreloError(
        `The API key lacks the scope for ${name} (403). Grant that scope on the key in Gorelo, or use an action the key allows.`,
        403,
        notifications,
      );
    }
    const detail = apiText(formatNotifications(notifications) || text.slice(0, 500) || res.statusText);
    throw new GoreloError(
      `Gorelo returned ${res.status} for ${name} (${op.method} ${op.path}): ${detail}`,
      res.status,
      notifications,
    );
  }

  private async unwrap(op: OperationDef, res: Response): Promise<Page> {
    if (!res.ok) return this.fail(op, res);
    const text = await res.text();
    if (!text) return { data: null, hasMore: false, notifications: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GoreloError(
        `Gorelo returned a non-JSON response for ${op.tool}.${op.action} (${res.status}): ${apiText(text.slice(0, 200))}`,
        res.status,
      );
    }
    // null, a primitive or an array is not an envelope: it is the data itself.
    if (!isRecord(parsed)) return { data: parsed, hasMore: false, notifications: [] };
    const body = parsed as {
      IsSuccess?: boolean;
      Data?: unknown;
      DataContext?: { Pagination?: { NextCursor?: string | null; HasMore?: boolean } };
    };
    const notifications = notificationsOf(parsed);
    if (body.IsSuccess === false) {
      throw new GoreloError(
        `Gorelo reported failure for ${op.tool}.${op.action}: ${apiText(formatNotifications(notifications))}`,
        res.status,
        notifications,
      );
    }
    const pagination = body.DataContext?.Pagination;
    return {
      data: "Data" in body ? body.Data : body,
      ...(pagination?.NextCursor ? { nextCursor: pagination.NextCursor } : {}),
      hasMore: pagination?.HasMore === true && Boolean(pagination.NextCursor),
      notifications,
    };
  }

  async json(
    op: OperationDef,
    params: Record<string, unknown>,
    body?: unknown,
    cursor?: string,
    pageSize?: number,
  ): Promise<Page> {
    const url = this.buildUrl(op, params, cursor, pageSize);
    const init: RequestInit =
      body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
    return this.guarded(op, async () => this.unwrap(op, await this.send(op, url, init)));
  }

  async binary(op: OperationDef, params: Record<string, unknown>): Promise<Uint8Array> {
    const url = this.buildUrl(op, params);
    return this.guarded(op, async () => {
      const res = await this.send(op, url, {});
      if (!res.ok) return this.fail(op, res);
      return new Uint8Array(await res.arrayBuffer());
    });
  }

  async multipart(op: OperationDef, form: FormData): Promise<Page> {
    const url = this.buildUrl(op, {});
    return this.guarded(op, async () => this.unwrap(op, await this.send(op, url, { body: form })));
  }
}
