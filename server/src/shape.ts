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
]);

export async function collectPages(
  fetchPage: (cursor?: string) => Promise<Page>,
  limit: number,
): Promise<{ items: unknown[]; nextCursor?: string; notifications: Notification[] }> {
  const items: unknown[] = [];
  const notifications: Notification[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const page = await fetchPage(cursor);
    notifications.push(...page.notifications);
    const batch = Array.isArray(page.data) ? page.data : page.data == null ? [] : [page.data];
    items.push(...batch);

    const next = page.hasMore ? page.nextCursor : undefined;
    if (items.length >= limit) {
      // Only hand back a cursor when the limit lands exactly on a page boundary;
      // otherwise resuming from it would silently skip the items we dropped.
      const exact = items.length === limit;
      return {
        items: items.slice(0, limit),
        ...(exact && next ? { nextCursor: next } : {}),
        notifications,
      };
    }
    if (!next || batch.length === 0 || seenCursors.has(next)) return { items, notifications };
    seenCursors.add(next);
    cursor = next;
  }
}

export function markUntrusted(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (!key || !UNTRUSTED_KEYS.has(key)) return value;
    // Escape any variant of the untrusted_content tag (case-insensitive, whitespace-tolerant)
    // to prevent injected tags from escaping the wrapper.
    const escaped = value.replace(/<(\s*\/?\s*untrusted_content)/gi, "&lt;$1");
    return `<untrusted_content>${escaped}</untrusted_content>`;
  }
  if (Array.isArray(value)) return value.map((v) => markUntrusted(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, markUntrusted(v, k)]));
  }
  return value;
}

export function renderResult(payload: unknown, maxChars = MAX_RESULT_CHARS): string {
  const text = JSON.stringify(payload, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… [truncated ${text.length - maxChars} chars. Narrow the request with filters or a smaller limit.]`;
}
