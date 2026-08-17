// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic seeded demo stream (04-widget-registry.md §5.3 demo mode, §7.7
 * determinism). Unbound stream widgets — Storybook, builder-palette previews,
 * first-run empty states — drive the exact same buffer/hook pipeline from this
 * generator instead of a live socket.
 *
 * `demoStreamRecords(seed, n)` is byte-identical across runs and platforms: the
 * canonical mulberry32 PRNG (no `Date.now`/`Math.random`) picks from fixed
 * template arrays, timestamps come from a fixed base plus an index step. The
 * generated records intentionally match the `log-table`/`activity-feed` row
 * shape so the demo transport can drive those shells directly.
 */

import type { StreamListener, StreamRealtimeEvent, StreamTransport } from './stream-types.js';

/** Mulberry32 — canonical form (matches `@adminium/charts`); deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A synthetic feed record (shape shared with `log-table` / `activity-feed`). */
export interface DemoStreamRecord {
  id: number;
  ts: string;
  actor: string;
  category: string;
  categoryTone: string;
  action: string;
  resource: string;
  status?: string;
  code?: number;
}

const DEMO_TEMPLATES: readonly Omit<DemoStreamRecord, 'id' | 'ts' | 'actor'>[] = [
  { category: 'auth', categoryTone: 'info', action: 'signed in', resource: 'session/9f2a', status: 'success' },
  { category: 'billing', categoryTone: 'warn', action: 'charge failed for', resource: 'sub_4821', code: 402 },
  { category: 'api', categoryTone: 'neutral', action: 'POST', resource: '/v1/orders', code: 201 },
  { category: 'webhook', categoryTone: 'accent', action: 'delivered', resource: 'order.paid', code: 200 },
  { category: 'api', categoryTone: 'neutral', action: 'GET', resource: '/v1/reports', code: 500 },
  { category: 'export', categoryTone: 'info', action: 'generated', resource: 'customers.csv', status: 'success' },
];

const DEMO_ACTORS: readonly string[] = ['Ada Lovelace', 'System', 'api-gw', 'Grace Hopper', 'cron'];

/** Fixed timeline anchor — never `Date.now()`, so runs are reproducible. */
export const DEMO_STREAM_BASE_MS = Date.UTC(2026, 6, 14, 14, 30, 0);
/** Per-index timestamp step (newer indices are later in time). */
export const DEMO_STREAM_STEP_MS = 3_200;

/** Deterministic channel name for demo/unbound stream widgets. */
export const DEMO_STREAM_CHANNEL = 'widget-data:demo:demo.events';

/** One deterministic record for `(seed, index)`. Stable across runs. */
export function demoStreamRecord(seed: number, index: number): DemoStreamRecord {
  const random = mulberry32(((seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const template = DEMO_TEMPLATES[Math.floor(random() * DEMO_TEMPLATES.length) % DEMO_TEMPLATES.length]!;
  const actor = DEMO_ACTORS[Math.floor(random() * DEMO_ACTORS.length) % DEMO_ACTORS.length]!;
  return {
    id: index + 1,
    ts: new Date(DEMO_STREAM_BASE_MS + index * DEMO_STREAM_STEP_MS).toISOString(),
    actor,
    ...template,
  };
}

/**
 * `count` deterministic records. `order: 'desc'` (default) returns them
 * newest-first (matching a server snapshot); `'asc'` returns oldest-first
 * (the order the demo transport emits them live).
 */
export function demoStreamRecords(
  seed: number,
  count: number,
  order: 'asc' | 'desc' = 'desc',
): DemoStreamRecord[] {
  const asc = Array.from({ length: Math.max(0, count) }, (_, index) => demoStreamRecord(seed, index));
  return order === 'asc' ? asc : asc.reverse();
}

/** Wrap a demo record as a `record.create` realtime event. */
export function demoStreamEvent(channel: string, record: DemoStreamRecord): StreamRealtimeEvent {
  return { channel, type: 'record.create', data: { type: 'record.create', row: record }, ts: record.ts };
}

export interface DemoStreamTransportOptions {
  seed: number;
  /** Emit cadence in ms; default 3200. */
  intervalMs?: number | undefined;
  /** Index the live emission starts from (past this, records are "new"). */
  startIndex?: number | undefined;
  /** Timer seams for deterministic tests; default the globals. */
  setInterval?: ((cb: () => void, ms: number) => unknown) | undefined;
  clearInterval?: ((handle: unknown) => void) | undefined;
}

/**
 * A {@link StreamTransport} that emits the deterministic demo stream on an
 * interval. Reports `connected: true` immediately. Multiple subscribers on the
 * same demo channel each get their own independent emission cursor, so a story
 * with several demo feeds stays reproducible per-widget.
 */
export function createDemoStreamTransport(opts: DemoStreamTransportOptions): StreamTransport {
  const intervalMs = opts.intervalMs ?? DEMO_STREAM_STEP_MS;
  const start = opts.startIndex ?? 0;
  const setTimer = opts.setInterval ?? ((cb, ms) => setInterval(cb, ms));
  const clearTimer = opts.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));

  return {
    subscribe(channel: string, listener: StreamListener, onStatus): () => void {
      onStatus?.(true);
      let index = start;
      const handle = setTimer(() => {
        listener(demoStreamEvent(channel, demoStreamRecord(opts.seed, index)));
        index += 1;
      }, intervalMs);
      return () => {
        onStatus?.(false);
        clearTimer(handle);
      };
    },
  };
}
