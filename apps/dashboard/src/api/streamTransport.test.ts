// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The multiplexed widget-data stream transport (04-widget-registry.md §5.3):
 * reference-counted channel subscribe/unsubscribe, per-channel fan-out, status
 * broadcast, and connection lifecycle — driven through a fake realtime client
 * (no socket).
 */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

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
