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
      for (const channel of options.channels) {
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
    const channels = encodeURIComponent(options.channels.join(','));
    sse = new EventSource(options.sseUrl ?? `/api/v1/events?channels=${channels}`);
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
  };
}
