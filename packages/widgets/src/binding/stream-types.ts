/**
 * `stream` data-binding shape — client transport contracts (04-widget-registry.md
 * §3 `stream`, §5.3 realtime). Append-only event delivery for the live widgets
 * (`realtime-feed`, live `log-table` tails, `unread-badge`).
 *
 * A widget bound to a `stream` descriptor receives, from the widget-data query,
 * a `StreamShape` envelope `{ channel, snapshot }` (the server resolves the
 * table id, so the channel is authoritative). It then subscribes to `channel`
 * over the injected {@link StreamTransport} (WS with SSE fallback, wired by the
 * host app) and folds subsequent events into a bounded buffer. Demo/unbound
 * mode drives the same pipeline from a deterministic seeded generator instead.
 *
 * This module is React-aware but transport-agnostic: the concrete WS/SSE
 * transport lives in the host app (`apps/dashboard/src/api/streamTransport.ts`)
 * and is injected through {@link StreamTransportProvider}. Tests and Storybook
 * inject a mock or the demo transport.
 */

/** The wire shape of every server→client realtime event (mirrors the hub). */
export interface StreamRealtimeEvent {
  channel: string;
  type: string;
  data: unknown;
  /** ISO-8601 UTC. */
  ts: string;
}

/** Fan-out sink for one subscribed channel. */
export type StreamListener = (event: StreamRealtimeEvent) => void;

/** Connection-status sink (WS open / SSE fallback open ⇒ `true`). */
export type StreamStatusListener = (connected: boolean) => void;

/**
 * A multiplexed realtime transport. `subscribe` attaches a listener to one
 * channel and returns the matching unsubscribe. The host implementation keeps
 * a single connection and reference-counts channels (WS `subscribe`/
 * `unsubscribe` frames, SSE fallback); the binding hook never sees the socket.
 */
export interface StreamTransport {
  subscribe(
    channel: string,
    listener: StreamListener,
    onStatus?: StreamStatusListener,
  ): () => void;
}

/**
 * Server→client `stream` envelope (04 §3 `StreamShape`). Returned by the
 * widget-data query for a `shape: 'stream'` descriptor: the resolved WS channel
 * plus the initial (PII-masked) snapshot rows the buffer seeds from.
 */
export interface StreamShape {
  shape: 'stream';
  channel: string;
  snapshot: Record<string, unknown>[];
  columns?: { name: string; logicalType: string; nullable: boolean; isPrimaryKey: boolean }[];
}

/**
 * Payload carried by a widget-data stream event's `data` field, published by
 * the server on CRUD/job mutations. `row` is always PII-masked (never a
 * forbidden column); `delete` events carry the masked pre-image so the buffer
 * can drop the row by key.
 */
export interface StreamEventPayload {
  /** e.g. `record.create` | `record.update` | `record.delete` | `record.bulk-*`. */
  type: string;
  pk?: unknown;
  row?: Record<string, unknown> | null | undefined;
}
