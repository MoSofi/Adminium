// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app's realtime stream transport (04-widget-registry.md §5.3). A single
 * multiplexed WS connection (SSE fallback) shared by every live stream widget,
 * exposed as the `StreamTransport` contract `@adminium/widgets/binding` expects.
 * `StreamProvider` puts it on the context; `useWidgetStream` reads it.
 *
 * This is deliberately its OWN connection, separate from the AppShell's
 * `config-changed` client (apps/dashboard/src/shell/AppShell.tsx): widget-data
 * channels are dynamic and per-role, so a forbidden channel on the SSE fallback
 * degrades only the streams, never the config-changed lifeline.
 *
 * Channels are reference-counted: the connection starts on the first
 * subscription and stops when the last one leaves; a channel's `subscribe`/
 * `unsubscribe` frame is sent only on its first/last listener.
 */

import { createRealtimeClient, type RealtimeClient, type RealtimeClientOptions, type RealtimeEvent } from '../app/ws.js';

/**
 * Structural mirror of the `@adminium/widgets/binding` transport contract. Kept
 * local so this module (and its tests) do not depend on the widgets build; a
 * `DashboardStreamTransport` is structurally assignable to the widgets
 * `StreamTransport` when handed to `StreamTransportProvider`.
 */
type StreamListener = (event: RealtimeEvent) => void;
type StreamStatusListener = (connected: boolean) => void;
interface StreamTransport {
  subscribe(channel: string, listener: StreamListener, onStatus?: StreamStatusListener): () => void;
}

/**
 * SSE named-event types the widget-data stream publisher emits (the server
 * frames SSE as `event: <type>`, so each must be registered). Mirrors the CRUD
 * mutation event types (apps/server/src/routes/data + widget-data publisher).
 */
export const STREAM_SSE_EVENT_TYPES = [
  'record.create',
  'record.update',
  'record.delete',
  'record.bulk-create',
  'record.bulk-update',
  'record.bulk-delete',
  'record.undo',
] as const;

export interface StreamTransportOptions {
  /** Seam for tests: build the underlying realtime client. */
  createClient?: (options: RealtimeClientOptions) => RealtimeClient;
}

export interface DashboardStreamTransport extends StreamTransport {
  /** Tear the shared connection down (app unmount). */
  stop(): void;
  /** Distinct channels with at least one listener. */
  readonly channelCount: number;
}

export function createStreamTransport(options: StreamTransportOptions = {}): DashboardStreamTransport {
  const make = options.createClient ?? createRealtimeClient;
  const listeners = new Map<string, Set<StreamListener>>();
  const statusListeners = new Set<StreamStatusListener>();
  let client: RealtimeClient | null = null;
  let connected = false;

  const dispatch = (event: RealtimeEvent): void => {
    const set = listeners.get(event.channel);
    if (set === undefined) return;
    for (const listener of [...set]) listener(event);
  };

  const setConnected = (next: boolean): void => {
    connected = next;
    for (const listener of [...statusListeners]) listener(next);
  };

  const ensureClient = (): void => {
    if (client !== null) return;
    client = make({
      channels: [...listeners.keys()],
      onEvent: dispatch,
      onStatusChange: setConnected,
      sseEventTypes: STREAM_SSE_EVENT_TYPES,
    });
    client.start();
  };

  const teardownIfIdle = (): void => {
    if (listeners.size > 0 || client === null) return;
    client.stop();
    client = null;
    connected = false;
  };

  return {
    get channelCount() {
      return listeners.size;
    },

    subscribe(channel: string, listener: StreamListener, onStatus?: StreamStatusListener): () => void {
      let set = listeners.get(channel);
      const firstForChannel = set === undefined;
      if (set === undefined) {
        set = new Set();
        listeners.set(channel, set);
      }
      set.add(listener);
      if (onStatus !== undefined) {
        statusListeners.add(onStatus);
        onStatus(connected);
      }

      if (client === null) {
        ensureClient(); // the channel is already in the initial set
      } else if (firstForChannel) {
        client.subscribe(channel);
      }

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const current = listeners.get(channel);
        if (current !== undefined) {
          current.delete(listener);
          if (current.size === 0) {
            listeners.delete(channel);
            client?.unsubscribe(channel);
          }
        }
        if (onStatus !== undefined) statusListeners.delete(onStatus);
        teardownIfIdle();
      };
    },

    stop() {
      client?.stop();
      client = null;
      connected = false;
      listeners.clear();
      statusListeners.clear();
    },
  };
}
