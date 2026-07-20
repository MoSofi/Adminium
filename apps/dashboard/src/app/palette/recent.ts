/**
 * ⌘K Recent tracking (09-generated-app.md §5.2): a mixed-entity recency list
 * in `localStorage['adminium-recent:<userId>']` — max 8 entries of
 * `{ type: 'table' | 'report' | 'record' | 'page', label, href }`, updated on
 * every page navigation / record open (AppShell watches the router) and moved
 * to the front on re-visit. Per-user key so shared browsers do not leak one
 * user's trail into another's palette. All storage access is fail-soft:
 * private-mode / quota errors degrade to "no Recent group", never a crash.
 */

export const RECENT_TYPES = ['table', 'report', 'record', 'page'] as const;
export type RecentType = (typeof RECENT_TYPES)[number];

export interface RecentEntry {
  type: RecentType;
  label: string;
  /** App-internal href, e.g. `/p/customers` or `/p/customers/r/ALFKI`. */
  href: string;
}

export const RECENT_MAX = 8;
const BASE_KEY = 'adminium-recent';

export function recentStorageKey(userId: string): string {
  return `${BASE_KEY}:${userId}`;
}

function isEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['label'] === 'string' &&
    typeof entry['href'] === 'string' &&
    (RECENT_TYPES as readonly string[]).includes(entry['type'] as string)
  );
}

export function readRecent(userId: string): RecentEntry[] {
  try {
    const raw = window.localStorage.getItem(recentStorageKey(userId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** Prepend (or move to front) one entry; dedup by href; cap at 8. */
export function pushRecent(userId: string, entry: RecentEntry): RecentEntry[] {
  const next = [entry, ...readRecent(userId).filter((e) => e.href !== entry.href)].slice(
    0,
    RECENT_MAX,
  );
  try {
    window.localStorage.setItem(recentStorageKey(userId), JSON.stringify(next));
  } catch {
    // Quota/private mode: the in-memory result is still correct for this render.
  }
  return next;
}
