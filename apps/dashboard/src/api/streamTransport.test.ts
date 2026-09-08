// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The multiplexed widget-data stream transport (04-widget-registry.md §5.3):
 * reference-counted channel subscribe/unsubscribe, per-channel fan-out, status
 * broadcast, and connection lifecycle — driven through a fake realtime client
 * (no socket).
 *
 * The last block drives the REAL client down to its SSE fallback instead,
 * because {@link STREAM_SSE_EVENT_TYPES} is one of those lists that cannot
 * fail loudly: the server frames SSE as `event: <type>`, a named event never
 * reaches `onmessage`, and an unregistered type is therefore delivered to
 * nobody in complete silence. Asserting the constant's contents would only
 * restate it; these tests emit the named frame the server sends.
 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeClient, RealtimeClientOptions, RealtimeEvent } from '../app/ws.js';
import { createStreamTransport } from './streamTransport.js';

function makeFakeClient() {
  return {
    started: false,
    stopped: false,
    subscribed: [] as string[],
    unsubscribed: [] as string[],
    start() {
      this.started = true;
    },
    stop() {
      this.stopped = true;
    },
    subscribe(channel: string) {
      this.subscribed.push(channel);
    },
    unsubscribe(channel: string) {
      this.unsubscribed.push(channel);
    },
  };
}

function harness() {
  const clients: ReturnType<typeof makeFakeClient>[] = [];
  const options: RealtimeClientOptions[] = [];
  const transport = createStreamTransport({
    createClient: (opts) => {
      options.push(opts);
      const client = makeFakeClient();
      clients.push(client);
      return client as unknown as RealtimeClient;
    },
  });
  return { transport, clients, options };
}

const event = (channel: string, type = 'record.create'): RealtimeEvent => ({
  channel,
  type,
  data: { type, row: { id: 1 } },
  ts: '2026-07-14T00:00:00Z',
});

describe('createStreamTransport', () => {
  it('starts one client on the first subscription with that channel in the initial set', () => {
    const { transport, clients, options } = harness();
    const listener = vi.fn();
    transport.subscribe('widget-data:c:public.a', listener);
    expect(clients).toHaveLength(1);
    expect(clients[0]?.started).toBe(true);
    expect(options[0]?.channels).toEqual(['widget-data:c:public.a']);
    expect(transport.channelCount).toBe(1);
  });

  it('fans events to the listeners of the matching channel only', () => {
    const { transport, options } = harness();
    const a = vi.fn();
    const b = vi.fn();
    transport.subscribe('chan-a', a);
    transport.subscribe('chan-b', b);
    options[0]?.onEvent(event('chan-a'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('sends subscribe only on a channel’s first listener and unsubscribe on its last', () => {
    const { transport, clients } = harness();
    const off1 = transport.subscribe('chan', vi.fn());
    const off2 = transport.subscribe('chan', vi.fn()); // second listener, same channel
    transport.subscribe('other', vi.fn());
    // 'chan' was in the initial client set; 'other' is the only dynamic subscribe.
    expect(clients[0]?.subscribed).toEqual(['other']);

    off2(); // 'chan' still has a listener → no unsubscribe
    expect(clients[0]?.unsubscribed).toEqual([]);
    off1(); // last 'chan' listener → unsubscribe
    expect(clients[0]?.unsubscribed).toEqual(['chan']);
  });

  it('broadcasts connection status and reports the current status on subscribe', () => {
    const { transport, options } = harness();
    const statusA = vi.fn();
    transport.subscribe('chan', vi.fn(), statusA);
    expect(statusA).toHaveBeenLastCalledWith(false); // not yet connected
    options[0]?.onStatusChange?.(true);
    expect(statusA).toHaveBeenLastCalledWith(true);

    // A later subscriber sees the current (connected) status immediately.
    const statusB = vi.fn();
    transport.subscribe('chan2', vi.fn(), statusB);
    expect(statusB).toHaveBeenLastCalledWith(true);
  });

  it('stops the client when the last channel leaves and restarts on the next subscribe', () => {
    const { transport, clients } = harness();
    const off = transport.subscribe('chan', vi.fn());
    expect(clients).toHaveLength(1);
    off();
    expect(clients[0]?.stopped).toBe(true);
    expect(transport.channelCount).toBe(0);

    transport.subscribe('chan2', vi.fn());
    expect(clients).toHaveLength(2);
    expect(clients[1]?.started).toBe(true);
  });

  it('stop() tears down the connection and clears channels', () => {
    const { transport, clients } = harness();
    transport.subscribe('chan', vi.fn());
    transport.stop();
    expect(clients[0]?.stopped).toBe(true);
    expect(transport.channelCount).toBe(0);
  });
});

// --- the SSE fallback's registered event types --------------------------------

class FallbackWebSocket {
  static instances: FallbackWebSocket[] = [];
  readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FallbackWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  fail(): void {
    this.readyState = 3;
    this.onerror?.();
    this.onclose?.();
  }
}

class FallbackEventSource {
  static instances: FallbackEventSource[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Named-event listeners, by type — the whole point of these tests. */
  readonly listeners = new Map<string, (event: { data: unknown }) => void>();
  constructor(readonly url: string) {
    FallbackEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: unknown }) => void): void {
    this.listeners.set(type, cb);
  }
  close(): void {}
  /** What the server writes: `event: <type>` + `data: <RealtimeEvent JSON>`. */
  emit(type: string, event: RealtimeEvent): void {
    this.listeners.get(type)?.({ data: JSON.stringify(event) });
  }
}

/** Real client, three WS failures, SSE open — returns the stream to emit on. */
function fallenBackTransport(channel: string, seen: RealtimeEvent[]) {
  vi.useFakeTimers();
  FallbackWebSocket.instances = [];
  FallbackEventSource.instances = [];
  vi.stubGlobal('WebSocket', FallbackWebSocket);
  vi.stubGlobal('EventSource', FallbackEventSource);
  // No `createClient` seam here: the point is the options the transport hands
  // the REAL client.
  const transport = createStreamTransport();
  transport.subscribe(channel, (event) => seen.push(event));
  FallbackWebSocket.instances[0]?.fail();
  vi.advanceTimersByTime(1000);
  FallbackWebSocket.instances[1]?.fail();
  vi.advanceTimersByTime(2000);
  FallbackWebSocket.instances[2]?.fail();
  const stream = FallbackEventSource.instances[0];
  if (stream === undefined) throw new Error('expected the SSE fallback to have opened');
  stream.onopen?.();
  return { transport, stream };
}

describe('STREAM_SSE_EVENT_TYPES over the real SSE fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('delivers record.attachments — the record page’s Attachments panel (37 D27)', () => {
    const channel = 'widget-data:conn_1:public.invoices';
    const seen: RealtimeEvent[] = [];
    const { transport, stream } = fallenBackTransport(channel, seen);

    stream.emit('record.attachments', {
      channel,
      type: 'record.attachments',
      data: { type: 'record.attachments', pk: { invoice_id: '1042' }, row: null },
      ts: '2026-09-05T00:00:00.000Z',
    });

    expect(seen.map((event) => event.type)).toEqual(['record.attachments']);
    transport.stop();
  });

  it('still delivers the CRUD mutation types it shipped with', () => {
    const channel = 'widget-data:conn_1:public.invoices';
    const seen: RealtimeEvent[] = [];
    const { transport, stream } = fallenBackTransport(channel, seen);

    for (const type of ['record.create', 'record.update', 'record.delete', 'record.undo']) {
      stream.emit(type, { channel, type, data: null, ts: '2026-09-05T00:00:00.000Z' });
    }

    expect(seen.map((event) => event.type)).toEqual([
      'record.create',
      'record.update',
      'record.delete',
      'record.undo',
    ]);
    transport.stop();
  });
});
