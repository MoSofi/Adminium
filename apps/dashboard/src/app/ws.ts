// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Realtime client (09-generated-app.md §2.1 step 4/5): connects to the
 * server's `GET /ws` gateway (apps/server/src/realtime/ws.ts protocol),
 * subscribes channels, and dispatches events. Falls back to the SSE endpoint
 * (`GET /api/v1/events?channels=…`) after repeated WS failures.
 *
 * The shell wires `config-changed` → invalidate `['bootstrap']` + `['page']`
 * so regeneration and nav edits propagate live without reload; three
 * consecutive connection failures flip `onStatusChange(false)` (offline
 * banner trigger per §6.1).
 */

export interface RealtimeEvent {
  channel: string;
  type: string;
  data: unknown;
  /** ISO-8601 UTC (apps/server/src/realtime/hub.ts). */
  ts: string;
}

export interface RealtimeClientOptions {
  channels: readonly string[];
  onEvent: (event: RealtimeEvent) => void;
  /** `false` after 3 consecutive failed connects; `true` on (re)connect. */
  onStatusChange?: ((connected: boolean) => void) | undefined;
  /**
   * SSE frames are named (`event: <type>`), so the fallback must register a
   * listener per expected type — extend when new publishers land.
   */
  sseEventTypes?: readonly string[] | undefined;
  /** Test seams. */
  wsUrl?: string | undefined;
  sseUrl?: string | undefined;
}

export interface RealtimeClient {
  start(): void;
  stop(): void;
  /**
   * Add a channel to the live subscription set. Sends a `subscribe` frame
   * immediately over an open WS; on the SSE fallback the stream is re-opened
   * with the new channel union. No-op if already subscribed. Channels added
   * before `start`/reconnect are (re)subscribed on connect.
   */
  subscribe(channel: string): void;
  /** Remove a channel from the subscription set (inverse of {@link subscribe}). */
  unsubscribe(channel: string): void;
}

const MAX_BACKOFF_MS = 30_000;
/** WS failures before flagging offline and trying the SSE fallback. */
const FAILURES_BEFORE_FALLBACK = 3;

function defaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value as Record<string, unknown>;
  return typeof frame.channel === 'string' && typeof frame.type === 'string';
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  let ws: WebSocket | null = null;
  let sse: EventSource | null = null;
  let stopped = true;
  let failures = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Mutable subscription set — seeded from options, grown/shrunk at runtime by
  // `subscribe`/`unsubscribe` (per-widget stream bindings, 04 §5.3).
  const channels = new Set(options.channels);

  const dispatch = (raw: unknown): void => {
    let frame: unknown;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (isRealtimeEvent(frame)) options.onEvent(frame);
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    failures += 1;
    if (failures === FAILURES_BEFORE_FALLBACK) {
      options.onStatusChange?.(false);
      startSse();
      return;
    }
    const backoff = Math.min(1_000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(connectWs, backoff);
  };

  const connectWs = (): void => {
    if (stopped) return;
    try {
      ws = new WebSocket(options.wsUrl ?? defaultWsUrl());
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      failures = 0;
      options.onStatusChange?.(true);
      for (const channel of channels) {
        ws?.send(JSON.stringify({ op: 'subscribe', channel }));
      }
    };
    ws.onmessage = (event) => dispatch(event.data);
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
    // onclose always follows onerror — reconnect is scheduled there.
    ws.onerror = () => {};
  };

  const startSse = (): void => {
    if (stopped || typeof EventSource === 'undefined') return;
    // The SSE endpoint carries channels in the URL and needs at least one
    // (empty ⇒ 400). Skip opening while the subscription set is empty.
    if (channels.size === 0) return;
    const query = encodeURIComponent([...channels].join(','));
    sse = new EventSource(options.sseUrl ?? `/api/v1/events?channels=${query}`);
    // Server frames SSE as `event: <type>` + `data: <RealtimeEvent JSON>`
    // (apps/server/src/realtime/sse.ts) — named events bypass `onmessage`.
    sse.onmessage = (event) => dispatch(event.data);
    const types = options.sseEventTypes ?? ['config-changed', 'changed', 'created', 'updated', 'deleted', 'progress'];
    for (const type of types) {
      sse.addEventListener(type, (event) => dispatch((event as MessageEvent).data));
    }
    sse.onopen = () => options.onStatusChange?.(true);
    sse.onerror = () => options.onStatusChange?.(false);
  };

  // Dynamic channels over SSE: the channel list is baked into the URL, so a
  // change means re-opening the stream with the new union.
  const restartSse = (): void => {
    if (sse === null) return;
    sse.close();
    sse = null;
    startSse();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      failures = 0;
      connectWs();
    },
    stop() {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      ws?.close();
      ws = null;
      sse?.close();
      sse = null;
    },
    subscribe(channel: string) {
      if (channels.has(channel)) return;
      channels.add(channel);
      if (ws !== null && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ op: 'subscribe', channel }));
      } else if (sse !== null) {
        restartSse();
      }
      // Otherwise the WS is (re)connecting — `onopen` subscribes the whole set.
    },
    unsubscribe(channel: string) {
      if (!channels.has(channel)) return;
      channels.delete(channel);
      if (ws !== null && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ op: 'unsubscribe', channel }));
      } else if (sse !== null) {
        restartSse();
      }
    },
  };
}
