/**
 * In-memory widget-data result cache (04-widget-registry.md §5.2 step 6).
 *
 * Keyed on `sha256(descriptor + params + connection + role scope)` so two
 * callers with different role sets (or unmask grants) never share entries.
 * TTL defaults to 30 s (constructor-configurable; 04 specifies
 * `min(binding.refreshInterval ?? 60, 60)` — the binding's interval lives
 * client-side, so the server applies a flat conservative TTL for now).
 *
 * `invalidateTable(connectionId, tableId)` drops a table's entries — the
 * CRUD mutation hook wires into it when the widget-data plugin and data
 * routes share one composition root (start.ts wiring, M4 exit). No
 * cross-process cache by design (works identically inside Electron).
 */

import { createHash } from 'node:crypto';

export const WIDGET_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 500;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  /** `${connectionId}:${tableId}` for mutation invalidation. */
  tableKey: string;
}

export function cacheKeyOf(input: {
  descriptor: unknown;
  params: unknown;
  connectionId: string;
  roleScope: string;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class WidgetDataCache {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, CacheEntry>();

  constructor(opts: { ttlMs?: number | undefined; now?: (() => number) | undefined } = {}) {
    this.#ttlMs = opts.ttlMs ?? WIDGET_CACHE_TTL_MS;
    this.#now = opts.now ?? Date.now;
  }

  get(key: string): unknown | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, connectionId: string, tableId: string): void {
    // FIFO eviction at the cap — Map iteration order is insertion order.
    if (!this.#entries.has(key) && this.#entries.size >= MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(key, {
      value,
      expiresAt: this.#now() + this.#ttlMs,
      tableKey: `${connectionId}:${tableId}`,
    });
  }

  /** Drop every cached result over one table (CRUD mutation invalidation). */
  invalidateTable(connectionId: string, tableId: string): void {
    const tableKey = `${connectionId}:${tableId}`;
    for (const [key, entry] of this.#entries) {
      if (entry.tableKey === tableKey) this.#entries.delete(key);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
