/**
 * Realtime client transport (apps/server/src/realtime/ws.ts + sse.ts protocol):
 * dynamic channel subscribe/unsubscribe frames over an open WS, and the WS→SSE
 * fallback after repeated connection failures — including re-opening the SSE
 * stream when the channel set changes (04-widget-registry.md §5.3).
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
});
