import type { Notification, Page } from "./http.js";

export const MAX_RESULT_CHARS = 25000;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
export const PAGE_SIZE = 200;

/** Fields whose text is written by end users or contacts and may carry prompt injection. */
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

/**
 * Wraps end-user text in <untrusted_content>. A string is wrapped when its own key is untrusted
 * or when any ancestor key is: once a value sits under an untrusted key, every string beneath it
 * (in nested objects and arrays) is wrapped.
 */
export function markUntrusted(value: unknown, key?: string, inherited = false): unknown {
  const untrusted = inherited || (key !== undefined && UNTRUSTED_KEYS.has(key));
  if (typeof value === "string") {
    if (!untrusted) return value;
    // Escape any variant of the untrusted_content tag (case-insensitive, whitespace-tolerant)
    // to prevent injected tags from escaping the wrapper.
    const escaped = value.replace(/<(\s*\/?\s*untrusted_content)/gi, "&lt;$1");
    return `<untrusted_content>${escaped}</untrusted_content>`;
  }
  if (Array.isArray(value)) return value.map((v) => markUntrusted(v, key, untrusted));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, markUntrusted(v, k, untrusted)]));
  }
  return value;
}

const LIST_NOTE = "Result truncated to fit; narrow with filters or page with next_cursor.";
const OPEN_TAG = "<untrusted_content>";
const CLOSE_TAG = "</untrusted_content>";

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
