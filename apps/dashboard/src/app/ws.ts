// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Realtime client (/5): connects to the server's `GET /ws` gateway
 * (apps/server/src/realtime/ws.ts protocol), subscribes channels, and
 * dispatches events. Falls back to the SSE endpoint (`GET
 * /api/v1/events?channels=…`) after repeated WS failures, and goes on trying
 * the socket: the stream is given up the moment the socket opens.
 *
 * The stream is a stopgap, never where a client stays. An event stream holds
 * one of the browser's six HTTP/1.1 connections to the server for as long as
 * it is open, and a page has several clients (the shell's, a session's, a
 * preview's). A server that was restarted (three failed connects take three
 * seconds) left every open tab on streams for good, and two such tabs took
 * all six connections: the next page asked for its data and waited forever.
 * Where the socket never opens (a proxy that refuses it), the page's clients
 * share ONE stream, so a tab costs one connection, not one per client.
 *
 * The shell wires `config-changed` → invalidate `['bootstrap']` + `['page']`
 * so regeneration and nav edits propagate live without reload; three
 * consecutive connection failures flip `onStatusChange(false)` (offline
 * banner trigger).
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

const DEFAULT_SSE_TYPES: readonly string[] = [
  'config-changed',
  // A project server's rebuilt code, and an app applied from its folder.
  'project-changed',
  'app-changed',
  'changed',
  'created',
  'updated',
  'deleted',
  'progress',
];

/** One client's part in an event stream. */
interface StreamUser {
  channels: ReadonlySet<string>;
  types: readonly string[];
  /** A frame as it arrived; the user keeps the ones on its own channels. */
  frame(raw: unknown): void;
  status(connected: boolean): void;
}

/** What a client holds of a stream: tell it the channels changed, or leave it. */
interface StreamHold {
  changed(): void;
  close(): void;
}

/** An event stream of a client's own (a test's `sseUrl`): re-opened when its channels change. */
function ownStream(url: string, user: StreamUser): StreamHold {
  let source: EventSource | null = null;
  const open = (): void => {
    source = new EventSource(url);
    // Server frames SSE as `event: <type>` + `data: <RealtimeEvent JSON>`
    // (apps/server/src/realtime/sse.ts) — named events bypass `onmessage`.
    source.onmessage = (event) => user.frame(event.data);
    for (const type of user.types) source.addEventListener(type, (event) => user.frame((event as MessageEvent).data));
    source.onopen = () => user.status(true);
    source.onerror = () => user.status(false);
  };
  open();
  return {
    changed() {
      source?.close();
      open();
    },
    close() {
      source?.close();
      source = null;
    },
  };
}

/*
 * The page's one event stream. Every client on the fallback shares it: a
 * stream costs one of the browser's six HTTP/1.1 connections to the server
 * for as long as it is open, and those six are shared by every tab. A stream
 * per client (a session page has three) left two tabs with no connection to
 * ask for anything. The channel list is in the address, so the stream is
 * re-opened when the set of channels or of event names changes.
 */
const pageStream = (() => {
  const users = new Set<StreamUser>();
  let source: EventSource | null = null;
  let opened = '';
  const sync = (): void => {
    const channels = [...new Set([...users].flatMap((user) => [...user.channels]))].sort();
    const types = [...new Set([...users].flatMap((user) => user.types))].sort();
    // The SSE endpoint needs at least one channel (empty ⇒ 400).
    const wanted = channels.length === 0 || typeof EventSource === 'undefined' ? '' : `${channels.join(',')} ${types.join(',')}`;
    if (wanted === opened) return;
    source?.close();
    source = null;
    opened = wanted;
    if (wanted === '') return;
    const stream = new EventSource(`/api/v1/events?channels=${encodeURIComponent(channels.join(','))}`);
    source = stream;
    const all = (raw: unknown): void => {
      for (const user of [...users]) user.frame(raw);
    };
    stream.onmessage = (event) => all(event.data);
    for (const type of types) stream.addEventListener(type, (event) => all((event as MessageEvent).data));
    stream.onopen = () => {
      for (const user of [...users]) user.status(true);
    };
    stream.onerror = () => {
      for (const user of [...users]) user.status(false);
    };
  };
  return {
    join(user: StreamUser): StreamHold {
      users.add(user);
      sync();
      return {
        changed: sync,
        close() {
          users.delete(user);
          sync();
        },
      };
    },
  };
})();

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  let ws: WebSocket | null = null;
  let sse: StreamHold | null = null;
  let stopped = true;
  let failures = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Mutable subscription set — seeded from options, grown/shrunk at runtime by
  // `subscribe`/`unsubscribe` (per-widget stream bindings).
  const channels = new Set(options.channels);

  /** `shared`: from the page's stream, which carries other clients' channels too. */
  const dispatch = (raw: unknown, shared = false): void => {
    let frame: unknown;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (isRealtimeEvent(frame) && (!shared || channels.has(frame.channel))) options.onEvent(frame);
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    failures += 1;
    if (failures === FAILURES_BEFORE_FALLBACK) {
      options.onStatusChange?.(false);
      startSse();
    }
    // The socket is tried again whether or not the stream stands in for it.
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
      // The socket is back: the stream that stood in for it gives its connection back.
      sse?.close();
      sse = null;
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
    if (stopped || sse !== null || typeof EventSource === 'undefined') return;
    const user: StreamUser = {
      channels,
      types: options.sseEventTypes ?? DEFAULT_SSE_TYPES,
      frame: (raw) => dispatch(raw, true),
      status: (connected) => options.onStatusChange?.(connected),
    };
    // A stream of its own needs a channel in its address; the page's stream waits for one.
    if (options.sseUrl !== undefined) sse = ownStream(options.sseUrl, user);
    else sse = pageStream.join(user);
  };

  // Dynamic channels over SSE: the channel list is baked into the URL, so a
  // change means re-opening the stream with the new union.
  const restartSse = (): void => {
    sse?.changed();
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
