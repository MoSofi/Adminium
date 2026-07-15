/**
 * Bounded, newest-first stream buffer (04-widget-registry.md §5.3). Pure and
 * immutable so the fold is unit-testable without a socket or the DOM:
 *
 * - `upsertStreamItem` prepends a new item (newest first) or replaces an
 *   existing one in place — this makes optimistic prepends idempotent when the
 *   server later echoes the same row (same key ⇒ replace, not duplicate);
 * - the buffer is capped at `max` items; the oldest fall off the tail;
 * - `unread` counts items added since the last `markStreamRead` (the
 *   `unread-badge` source of truth); replacements and optimistic prepends do
 *   not bump it.
 */

/** Default retained-item cap for a stream buffer. */
export const DEFAULT_STREAM_MAX = 100;

export interface StreamBufferState<T> {
  /** Newest-first, length ≤ `max`. */
  readonly items: readonly T[];
  /** Items added since the last `markStreamRead`. */
  readonly unread: number;
}

export interface StreamUpsertOptions<T> {
  getKey: (item: T) => string | number;
  /** Retained-item cap; default {@link DEFAULT_STREAM_MAX}. */
  max?: number | undefined;
  /** Count this insert toward `unread`; default `true`. Optimistic/self writes pass `false`. */
  countUnread?: boolean | undefined;
}

/** Seed a buffer from an initial snapshot (already newest-first). `unread` = 0. */
export function seedStreamBuffer<T>(
  snapshot: readonly T[] = [],
  max: number = DEFAULT_STREAM_MAX,
): StreamBufferState<T> {
  const cap = Math.max(0, max);
  return { items: snapshot.slice(0, cap), unread: 0 };
}

function indexOfKey<T>(
  items: readonly T[],
  key: string | number,
  getKey: (item: T) => string | number,
): number {
  for (let i = 0; i < items.length; i += 1) {
    if (getKey(items[i] as T) === key) return i;
  }
  return -1;
}

/**
 * Prepend `item` (newest first), or replace the existing item with the same key
 * in place. A replacement keeps its position and never bumps `unread`.
 */
export function upsertStreamItem<T>(
  state: StreamBufferState<T>,
  item: T,
  opts: StreamUpsertOptions<T>,
): StreamBufferState<T> {
  const max = Math.max(0, opts.max ?? DEFAULT_STREAM_MAX);
  const countUnread = opts.countUnread ?? true;
  const key = opts.getKey(item);
  const existing = indexOfKey(state.items, key, opts.getKey);
  if (existing >= 0) {
    const items = state.items.slice();
    items[existing] = item;
    return { items, unread: state.unread };
  }
  const prepended = [item, ...state.items];
  const items = prepended.length > max ? prepended.slice(0, max) : prepended;
  return { items, unread: countUnread ? state.unread + 1 : state.unread };
}

/**
 * Apply a batch of items in chronological order (oldest → newest); the newest
 * ends up at index 0. Equivalent to folding `upsertStreamItem` left-to-right.
 */
export function upsertStreamItems<T>(
  state: StreamBufferState<T>,
  items: readonly T[],
  opts: StreamUpsertOptions<T>,
): StreamBufferState<T> {
  return items.reduce((acc, item) => upsertStreamItem(acc, item, opts), state);
}

/** Drop the item with `key`, if present. Never changes `unread`. */
export function removeStreamItem<T>(
  state: StreamBufferState<T>,
  key: string | number,
  getKey: (item: T) => string | number,
): StreamBufferState<T> {
  const index = indexOfKey(state.items, key, getKey);
  if (index < 0) return state;
  const items = state.items.slice();
  items.splice(index, 1);
  return { items, unread: state.unread };
}

/** Reset the unread counter (the feed has been viewed). */
export function markStreamRead<T>(state: StreamBufferState<T>): StreamBufferState<T> {
  return state.unread === 0 ? state : { items: state.items, unread: 0 };
}
