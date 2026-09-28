import type { Notification, Page } from "./http.js";

export const MAX_RESULT_CHARS = 25000;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
export const PAGE_SIZE = 200;

/**
 * Fields that are always free text written by end users or contacts. Every string is wrapped by
 * default; these keys additionally force wrapping of everything beneath them, machine-shaped or not.
 */
export const UNTRUSTED_KEYS = new Set([
  "Title",
  "Subject",
  "Description",
  "Body",
  "BodyHtml",
  "BodyText",
  "Comment",
  "Message",
  "Content",
  "Notes",
  "Answer",
  "Answers",
  "Reason",
  "StatusReason",
  "TextValue",
  "Summary",
  "OptionValues",
]);

export interface Collected {
  items: unknown[];
  /** True when the API has more rows than were returned. */
  hasMore: boolean;
  /** Present only when resuming from it continues exactly after the last returned item. */
  nextCursor?: string;
  notifications: Notification[];
}

/**
 * Follows cursors until `limit` items are collected. Each page requests
 * PageSize = min(maxPageSize, limit - collected) so the limit always lands on a page boundary
 * and the API's cursor stays valid for resuming.
 */
export async function collectPages(
  fetchPage: (cursor: string | undefined, pageSize: number) => Promise<Page>,
  limit: number,
  maxPageSize = PAGE_SIZE,
): Promise<Collected> {
  const items: unknown[] = [];
  const notifications: Notification[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const want = Math.min(maxPageSize, limit - items.length);
    const page = await fetchPage(cursor, want);
    notifications.push(...page.notifications);
    const batch = Array.isArray(page.data) ? page.data : page.data == null ? [] : [page.data];
    const next = page.hasMore ? page.nextCursor : undefined;

    if (batch.length > want) {
      // The API ignored PageSize; the cursor now points past rows we are dropping.
      items.push(...batch.slice(0, want));
      return { items, hasMore: true, notifications };
    }
    items.push(...batch);
    if (!next) return { items, hasMore: false, notifications };
    if (items.length >= limit) return { items, hasMore: true, nextCursor: next, notifications };
    if (batch.length === 0) return { items, hasMore: true, nextCursor: next, notifications };
    // A repeated cursor would loop forever; more rows exist but we cannot page to them safely.
    if (seenCursors.has(next)) return { items, hasMore: true, notifications };
    seenCursors.add(next);
    cursor = next;
  }
}

const OPEN_TAG = "<untrusted_content>";
const CLOSE_TAG = "</untrusted_content>";

/** Wraps text that came from outside the server in <untrusted_content>. */
export function wrapUntrusted(text: string): string {
  // Escape any variant of the untrusted_content tag (case-insensitive, whitespace-tolerant)
  // to prevent injected tags from escaping the wrapper.
  return `${OPEN_TAG}${text.replace(/<(\s*\/?\s*untrusted_content)/gi, "&lt;$1")}${CLOSE_TAG}`;
}

/**
 * Keys that hold machine values: ids, cursors, codes, timestamps, time zones, colours, versions.
 * External* ids are excluded because integrations and users choose them. URLs are never exempt:
 * their path and query can carry text.
 */
const SAFE_KEY =
  /^(?!External)(Id|On|Code|TimeZone|Color|.*[a-z0-9](Ids?|Cursor|On|At|DateTime|Version)|next_cursor)$/;
/** What a safe key may hold unwrapped: one short token with no spaces, quotes or angle brackets. */
const TOKEN = /^[\w.:+/=~#-]{1,128}$/;
/** Values that are machine-shaped under any key: a UUID, an ISO 8601 date or date-time, a number. */
const MACHINE_VALUE = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  /^[+-]?\d{1,30}(\.\d{1,30})?$/,
];

function isSafeString(value: string, key: string | undefined): boolean {
  if (MACHINE_VALUE.some((re) => re.test(value))) return true;
  return key !== undefined && SAFE_KEY.test(key) && TOKEN.test(value);
}

function mark(value: unknown, key: string | undefined, inherited: boolean): unknown {
  const untrusted = inherited || (key !== undefined && UNTRUSTED_KEYS.has(key));
  if (typeof value === "string") {
    return !untrusted && isSafeString(value, key) ? value : wrapUntrusted(value);
  }
  if (Array.isArray(value)) return value.map((v) => mark(v, key, untrusted));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mark(v, k, untrusted)]));
  }
  return value;
}

/** Top-level keys the registry writes itself; their text is not from the API. */
const LIST_ENVELOPE_KEYS = new Set(["count", "has_more", "next_cursor", "note", "omitted"]);

function isDownloadResult(payload: object): boolean {
  const keys = Object.keys(payload);
  const { path, bytes } = payload as { path?: unknown; bytes?: unknown };
  return keys.length === 2 && typeof path === "string" && typeof bytes === "number";
}

/**
 * Wraps text from the API in <untrusted_content>. Every string is wrapped unless it is clearly a
 * machine value: a compact token under a known-safe key, or a UUID, ISO date or number under any
 * key. Once a value sits under an UNTRUSTED_KEYS key, every string beneath it (in nested objects
 * and arrays) is wrapped. The registry's own envelope fields (note, next_cursor, path) are left
 * as written, but only at the top level: the same keys inside API data are wrapped.
 */
/**
 * Marks data that came from the API. Unlike markUntrusted it never treats the value as one of the
 * server's own envelopes, so an API body shaped like one cannot get its fields passed through bare.
 */
export function markApiData(value: unknown): unknown {
  return mark(value, undefined, false);
}

export function markUntrusted(value: unknown, key?: string, inherited = false): unknown {
  if (key === undefined && !inherited && value && typeof value === "object" && !Array.isArray(value)) {
    if (isDownloadResult(value)) return value;
    if (isListResult(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, LIST_ENVELOPE_KEYS.has(k) ? v : mark(v, k, false)]),
      );
    }
  }
  return mark(value, key, inherited);
}

const LIST_NOTE = "Result truncated to fit; narrow with filters or page with next_cursor.";

function isListResult(payload: unknown): payload is Record<string, unknown> & { items: unknown[] } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    Array.isArray((payload as { items?: unknown }).items) &&
    "count" in payload
  );
}

/** Renders a list result keeping the first `keep` items, with metadata before the items. */
function renderList(payload: Record<string, unknown> & { items: unknown[] }, keep: number): string {
  const { items, count: _count, next_cursor: _cursor, has_more: _more, note: prior, ...rest } = payload;
  const omitted = items.length - keep;
  if (omitted === 0) return JSON.stringify(payload, null, 2);
  return JSON.stringify(
    {
      count: keep,
      // Dropped rows sit between the last shown item and the API cursor, so the cursor is withheld.
      has_more: true,
      omitted,
      note: `${prior ? `${String(prior)} ` : ""}${LIST_NOTE} ${omitted} item(s) were dropped, so next_cursor is withheld (resuming from it would skip them). Rerun with limit ${Math.max(1, keep)} or less and page with next_cursor from that call.`,
      ...rest,
      items: items.slice(0, keep),
    },
    null,
    2,
  );
}

/** Cuts pretty JSON to maxChars, never leaving an <untrusted_content> tag open. */
function truncateText(text: string, maxChars: number): string {
  let cut = text.slice(0, maxChars);
  const open = cut.lastIndexOf(OPEN_TAG);
  if (open > cut.lastIndexOf(CLOSE_TAG)) cut = cut.slice(0, open);
  return `${cut}\n… [truncated ${text.length - cut.length} chars. Narrow the request with filters or a smaller limit.]`;
}

export function renderResult(payload: unknown, maxChars = MAX_RESULT_CHARS): string {
  const text = JSON.stringify(payload, null, 2);
  if (text.length <= maxChars) return text;
  if (isListResult(payload)) {
    // Binary search for the largest number of leading items that fits.
    let lo = 0;
    let hi = payload.items.length - 1;
    if (renderList(payload, 0).length <= maxChars) {
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (renderList(payload, mid).length <= maxChars) lo = mid;
        else hi = mid - 1;
      }
      return renderList(payload, lo);
    }
  }
  return truncateText(text, maxChars);
}
