// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Realtime client transport (apps/server/src/realtime/ws.ts + sse.ts protocol):
 * dynamic channel subscribe/unsubscribe frames over an open WS, and the WS→SSE
 * fallback after repeated connection failures — including re-opening the SSE
 * stream when the channel set changes.
 */
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRealtimeClient } from './ws.js';
import type { RealtimeEvent } from './ws.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = this.OPEN;
    this.onopen?.();
  }
  fail(): void {
    this.readyState = 3;
    this.onerror?.();
    this.onclose?.();
  }
  message(data: unknown): void {
    this.onmessage?.({ data });
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly listeners = new Map<string, (event: { data: unknown }) => void>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: unknown }) => void): void {
    this.listeners.set(type, cb);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.();
  }
  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data });
  }
}

const frame = (channel: string, type = 'record.create'): string =>
  JSON.stringify({ channel, type, data: { type, row: { id: 1 } }, ts: '2026-07-14T00:00:00Z' } satisfies RealtimeEvent);

let originalWs: unknown;
let originalEs: unknown;

beforeEach(() => {
  originalWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  originalEs = (globalThis as { EventSource?: unknown }).EventSource;
  FakeWebSocket.instances = [];
  FakeEventSource.instances = [];
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket as unknown;
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource as unknown;
});

afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWs;
  (globalThis as { EventSource?: unknown }).EventSource = originalEs;
  vi.useRealTimers();
});

describe('createRealtimeClient — dynamic channels over WS', () => {
  it('subscribes the initial set on open and sends frames for runtime add/remove', () => {
    const seen: RealtimeEvent[] = [];
    const client = createRealtimeClient({
      channels: ['a'],
      wsUrl: 'ws://test/ws',
      onEvent: (event) => seen.push(event),
    });
    client.start();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    expect(ws.sent).toEqual([JSON.stringify({ op: 'subscribe', channel: 'a' })]);

    client.subscribe('b');
    client.subscribe('b'); // idempotent
    client.unsubscribe('a');
    expect(ws.sent).toEqual([
      JSON.stringify({ op: 'subscribe', channel: 'a' }),
      JSON.stringify({ op: 'subscribe', channel: 'b' }),
      JSON.stringify({ op: 'unsubscribe', channel: 'a' }),
    ]);

    ws.message(frame('b'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.channel).toBe('b');
    client.stop();
  });

  it('re-subscribes the whole set (including runtime adds) after a reconnect', () => {
    vi.useFakeTimers();
    const client = createRealtimeClient({ channels: ['a'], wsUrl: 'ws://test/ws', onEvent: () => undefined });
    client.start();
    const first = FakeWebSocket.instances[0]!;
    first.open();
    client.subscribe('b'); // added while connected
    first.fail(); // drop → reconnect scheduled
    vi.advanceTimersByTime(1000);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    expect(second.sent).toEqual([
      JSON.stringify({ op: 'subscribe', channel: 'a' }),
      JSON.stringify({ op: 'subscribe', channel: 'b' }),
    ]);
    client.stop();
  });
});

describe('createRealtimeClient — SSE fallback', () => {
  it('falls back to SSE after 3 WS failures and delivers events, then re-opens on channel change', () => {
    vi.useFakeTimers();
    const seen: RealtimeEvent[] = [];
    const status: boolean[] = [];
    const client = createRealtimeClient({
      channels: ['a'],
      wsUrl: 'ws://test/ws',
      sseUrl: undefined, // default `/api/v1/events?channels=…`
      sseEventTypes: ['record.create'],
      onEvent: (event) => seen.push(event),
      onStatusChange: (connected) => status.push(connected),
    });
    client.start();

    // Three consecutive WS failures trigger the SSE fallback.
    FakeWebSocket.instances[0]!.fail();
    vi.advanceTimersByTime(1000);
    FakeWebSocket.instances[1]!.fail();
    vi.advanceTimersByTime(2000);
    FakeWebSocket.instances[2]!.fail();

    expect(status).toContain(false); // offline flagged at the 3rd failure
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toContain('channels=a');

    es.open();
    es.emit('record.create', frame('a'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.channel).toBe('a');

    // Dynamic subscribe over SSE re-opens the stream with the new union.
    client.subscribe('b');
    expect(es.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toContain('b');
    client.stop();
  });

  it('shares one stream among the page’s clients, each given only its own channels', () => {
    vi.useFakeTimers();
    const got: Record<string, string[]> = { one: [], two: [] };
    const make = (name: 'one' | 'two', channel: string) =>
      createRealtimeClient({ channels: [channel], wsUrl: 'ws://test/ws', sseEventTypes: ['record.create'], onEvent: (event) => got[name]!.push(event.channel) });
    const down = (): void => {
      // Every socket open so far fails, three rounds: each client falls back.
      for (const wait of [1000, 2000, 0]) {
        for (const socket of FakeWebSocket.instances.filter((candidate) => candidate.readyState === 0)) socket.fail();
        vi.advanceTimersByTime(wait);
      }
    };
    const one = make('one', 'a');
    const two = make('two', 'b');
    one.start();
    two.start();
    down();
    // One stream is open, for both channels; the ones it replaced are closed.
    const open = FakeEventSource.instances.filter((stream) => !stream.closed);
    expect(open).toHaveLength(1);
    expect(decodeURIComponent(open[0]!.url)).toContain('channels=a,b');
    open[0]!.emit('record.create', frame('a'));
    open[0]!.emit('record.create', frame('b'));
    expect(got).toEqual({ one: ['a'], two: ['b'] });

    // One client leaves: the stream goes on for the other, without the channel nobody reads.
    one.stop();
    const left = FakeEventSource.instances.filter((stream) => !stream.closed);
    expect(left).toHaveLength(1);
    expect(decodeURIComponent(left[0]!.url)).toContain('channels=b');
    two.stop();
    expect(FakeEventSource.instances.filter((stream) => !stream.closed)).toHaveLength(0);
  });

  it('goes on trying the socket behind the stream, and gives the stream up when the socket opens', () => {
    vi.useFakeTimers();
    const status: boolean[] = [];
    const client = createRealtimeClient({ channels: ['a'], wsUrl: 'ws://test/ws', onEvent: () => undefined, onStatusChange: (connected) => status.push(connected) });
    client.start();
    // The server is away for a restart: three failed connects, and the stream stands in.
    FakeWebSocket.instances[0]!.fail();
    vi.advanceTimersByTime(1000);
    FakeWebSocket.instances[1]!.fail();
    vi.advanceTimersByTime(2000);
    FakeWebSocket.instances[2]!.fail();
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0]!;
    expect(es.closed).toBe(false);

    // The socket is tried again, with a longer wait each time and no second stream.
    vi.advanceTimersByTime(4000);
    expect(FakeWebSocket.instances).toHaveLength(4);
    FakeWebSocket.instances[3]!.fail();
    vi.advanceTimersByTime(8000);
    expect(FakeWebSocket.instances).toHaveLength(5);
    expect(FakeEventSource.instances).toHaveLength(1);

    // It opens: the channels are subscribed on it, and the stream's connection is given back.
    FakeWebSocket.instances[4]!.open();
    expect(FakeWebSocket.instances[4]!.sent).toEqual([JSON.stringify({ op: 'subscribe', channel: 'a' })]);
    expect(es.closed).toBe(true);
    expect(status.at(-1)).toBe(true);

    // A later outage falls back again, on a new stream.
    FakeWebSocket.instances[4]!.fail();
    vi.advanceTimersByTime(1000);
    FakeWebSocket.instances[5]!.fail();
    vi.advanceTimersByTime(2000);
    FakeWebSocket.instances[6]!.fail();
    expect(FakeEventSource.instances).toHaveLength(2);
    client.stop();
    expect(FakeEventSource.instances[1]!.closed).toBe(true);
  });
});
