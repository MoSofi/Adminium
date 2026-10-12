// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `useWidgetStream` — the client half of the `stream` binding. A stream widget
 * (realtime-feed, live log-table tail, unread-badge) calls this with the
 * server-returned `channel` + `snapshot` (bound mode) or a demo seed
 * (unbound/preview mode); it subscribes over the injected {@link StreamTransport},
 * folds events into a bounded newest-first buffer, and exposes the buffer, an unread
 * counter, a connection flag, pause/resume, and an optimistic `prepend`.
 *
 * Transport is injected via {@link StreamTransportProvider} (bound mode) or
 * built in-hook from the deterministic demo generator (unbound mode). The hook
 * itself is transport-agnostic, so it is fully unit-testable with a mock
 * transport — no socket, no server.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEMO_STREAM_CHANNEL, createDemoStreamTransport } from './demo-stream.js';
import {
  DEFAULT_STREAM_MAX,
  markStreamRead,
  removeStreamItem,
  seedStreamBuffer,
  upsertStreamItem,
  type StreamBufferState,
} from './stream-buffer.js';
import { useStreamTransport } from './StreamTransportContext.js';
import type {
  StreamEventPayload,
  StreamRealtimeEvent,
  StreamTransport,
} from './stream-types.js';

export interface UseWidgetStreamOptions<T> {
  /** Authoritative channel from the server `StreamShape`. Absent ⇒ demo mode. */
  channel?: string | undefined;
  /** Initial rows (server `StreamShape.snapshot`), newest-first. */
  snapshot?: readonly T[] | undefined;
  /** Stable identity for dedupe/optimistic reconciliation (required). */
  getKey: (item: T) => string | number;
  /** Retained-item cap; default {@link DEFAULT_STREAM_MAX}. */
  max?: number | undefined;
  /** Map an event payload → item; default reads `payload.row`. `null` ⇒ ignore. */
  selectItem?: ((payload: StreamEventPayload, event: StreamRealtimeEvent) => T | null) | undefined;
  /** Event types treated as removals; default: type ends with `delete`. */
  isRemoval?: ((payload: StreamEventPayload) => boolean) | undefined;
  /** Demo/unbound mode seed + cadence (used only when `channel` is absent). */
  demo?: { seed: number; intervalMs?: number | undefined } | undefined;
  /** Controlled pause; omit for internal pause state. */
  paused?: boolean | undefined;
  onPausedChange?: ((paused: boolean) => void) | undefined;
  /** Explicit transport override (tests); otherwise context/demo transport. */
  transport?: StreamTransport | undefined;
}

export interface WidgetStream<T> {
  /** Newest-first buffered items (≤ `max`). */
  items: readonly T[];
  /** Unseen items: buffered-since-`markRead` plus any held while paused. */
  unread: number;
  /** WS/SSE connected (demo transport reports `true`). */
  connected: boolean;
  /** Paused state (content frozen; incoming events held until resume). */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Mark the visible feed as read (does not clear paused-held items). */
  markRead: () => void;
  /** Optimistically prepend a locally-created item (does not bump unread). */
  prepend: (item: T) => void;
}

function defaultSelectItem<T>(payload: StreamEventPayload): T | null {
  return payload.row !== null && payload.row !== undefined && typeof payload.row === 'object'
    ? (payload.row as unknown as T)
    : null;
}

function defaultIsRemoval(payload: StreamEventPayload): boolean {
  return typeof payload.type === 'string' && payload.type.endsWith('delete');
}

/** A stream mutation held while paused, replayed in order on resume. */
type PendingOp<T> = { kind: 'upsert'; item: T } | { kind: 'remove'; key: string | number } | { kind: 'let-go'; key: string };

/**
 * The key of a row a frame says to let go of: `pk` with one value and no
 * `row`. Read as text, because a key column's value and a widget's own key
 * for the row are the same value and not always the same type. A key of
 * several columns names no single widget key, and is left to the next
 * refetch.
 */
function keyOfLetGo(payload: StreamEventPayload): string | null {
  // Only a frame the server marked: a key with no row is also how "a file was attached to this record" arrives, and that row stays.
  if ((payload as { gone?: unknown }).gone !== true) return null;
  if (payload.row !== null && payload.row !== undefined) return null;
  const pk = payload.pk;
  if (pk === null || pk === undefined) return null;
  if (typeof pk === 'string' || typeof pk === 'number') return String(pk);
  if (typeof pk !== 'object') return null;
  const values = Object.values(pk as Record<string, unknown>);
  const only = values.length === 1 ? values[0] : undefined;
  return typeof only === 'string' || typeof only === 'number' ? String(only) : null;
}

export function useWidgetStream<T>(options: UseWidgetStreamOptions<T>): WidgetStream<T> {
  const isDemo = options.channel === undefined && options.demo !== undefined;
  const channel = options.channel ?? (isDemo ? DEMO_STREAM_CHANNEL : undefined);

  const contextTransport = useStreamTransport();
  const demoSeed = options.demo?.seed;
  const demoInterval = options.demo?.intervalMs;
  const demoTransport = useMemo(
    () => (demoSeed !== undefined ? createDemoStreamTransport({ seed: demoSeed, intervalMs: demoInterval }) : null),
    [demoSeed, demoInterval],
  );
  const transport = options.transport ?? (isDemo ? demoTransport : contextTransport);

  const max = options.max ?? DEFAULT_STREAM_MAX;

  // --- latest-value refs so the transport callback stays stable --------------
  const getKeyRef = useRef(options.getKey);
  getKeyRef.current = options.getKey;
  const selectItemRef = useRef(options.selectItem ?? defaultSelectItem<T>);
  selectItemRef.current = options.selectItem ?? defaultSelectItem<T>;
  const isRemovalRef = useRef(options.isRemoval ?? defaultIsRemoval);
  isRemovalRef.current = options.isRemoval ?? defaultIsRemoval;
  const maxRef = useRef(max);
  maxRef.current = max;

  const [buffer, setBuffer] = useState<StreamBufferState<T>>(() =>
    seedStreamBuffer(options.snapshot ?? [], max),
  );
  const [connected, setConnected] = useState(false);
  const [internalPaused, setInternalPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const pendingRef = useRef<PendingOp<T>[]>([]);

  const paused = options.paused ?? internalPaused;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const onPausedChangeRef = useRef(options.onPausedChange);
  onPausedChangeRef.current = options.onPausedChange;
  const controlledPaused = options.paused !== undefined;

  // --- re-seed when the binding (channel) changes ----------------------------
  const snapshotRef = useRef(options.snapshot);
  snapshotRef.current = options.snapshot;
  // Re-seed only on a new binding (channel); the live stream fills subsequent
  // updates. `snapshot`/`max` are read from refs so a new array identity does
  // not thrash the buffer.
  useEffect(() => {
    setBuffer(seedStreamBuffer(snapshotRef.current ?? [], maxRef.current));
    pendingRef.current = [];
    setPendingCount(0);
  }, [channel]);

  // --- event application (reads latest values via refs) ----------------------
  const handleEvent = useRef((event: StreamRealtimeEvent): void => {
    const payload = (event.data ?? {}) as StreamEventPayload;
    const item = selectItemRef.current(payload, event);
    // A key and no row, on a frame that is no delete: the row is somebody else's now (handed to a colleague).
    // The server sends its key so this screen lets go of it; the row itself is no longer this reader's to see.
    const gone = item === null && !isRemovalRef.current(payload) ? keyOfLetGo(payload) : null;
    if (gone !== null) {
      const match = (prev: Parameters<typeof removeStreamItem<T>>[0]) => prev.items.find((held) => String(getKeyRef.current(held)) === gone);
      if (pausedRef.current) {
        // Held like any other removal while the feed is frozen; the key is found when it is replayed.
        pendingRef.current = [...pendingRef.current, { kind: 'let-go', key: gone }];
        return;
      }
      setBuffer((prev) => {
        const held = match(prev);
        return held === undefined ? prev : removeStreamItem(prev, getKeyRef.current(held), getKeyRef.current);
      });
      return;
    }
    if (isRemovalRef.current(payload)) {
      if (item === null) return;
      const key = getKeyRef.current(item);
      // While paused the feed is frozen — hold the removal too (not just
      // upserts) so a concurrent delete does not splice a visible row out.
      if (pausedRef.current) {
        pendingRef.current = [...pendingRef.current, { kind: 'remove', key }];
        return;
      }
      setBuffer((prev) => removeStreamItem(prev, key, getKeyRef.current));
      return;
    }
    if (item === null) return;
    if (pausedRef.current) {
      pendingRef.current = [...pendingRef.current, { kind: 'upsert', item }];
      setPendingCount((count) => count + 1);
      return;
    }
    setBuffer((prev) =>
      upsertStreamItem(prev, item, { getKey: getKeyRef.current, max: maxRef.current, countUnread: true }),
    );
  });

  // --- subscribe / unsubscribe on transport or channel change ----------------
  useEffect(() => {
    if (transport === null || transport === undefined || channel === undefined) {
      setConnected(false);
      return;
    }
    const unsubscribe = transport.subscribe(
      channel,
      (event) => handleEvent.current(event),
      (status) => setConnected(status),
    );
    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [transport, channel]);

  // --- flush paused-held ops (upserts + removals) on resume, in order --------
  useEffect(() => {
    if (paused || pendingRef.current.length === 0) return;
    const flush = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    setBuffer((prev) => {
      let next = prev;
      for (const op of flush) {
        if (op.kind === 'let-go') {
          const held = next.items.find((item) => String(getKeyRef.current(item)) === op.key);
          if (held !== undefined) next = removeStreamItem(next, getKeyRef.current(held), getKeyRef.current);
          continue;
        }
        next =
          op.kind === 'upsert'
            ? upsertStreamItem(next, op.item, { getKey: getKeyRef.current, max: maxRef.current, countUnread: true })
            : removeStreamItem(next, op.key, getKeyRef.current);
      }
      return next;
    });
  }, [paused]);

  const setPaused = useCallback(
    (next: boolean) => {
      if (!controlledPaused) setInternalPaused(next);
      onPausedChangeRef.current?.(next);
    },
    [controlledPaused],
  );

  const markRead = useCallback(() => {
    setBuffer((prev) => markStreamRead(prev));
  }, []);

  const prepend = useCallback((item: T) => {
    setBuffer((prev) =>
      upsertStreamItem(prev, item, { getKey: getKeyRef.current, max: maxRef.current, countUnread: false }),
    );
  }, []);

  return {
    items: buffer.items,
    unread: buffer.unread + pendingCount,
    connected,
    paused,
    setPaused,
    markRead,
    prepend,
  };
}
