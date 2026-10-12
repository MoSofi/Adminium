// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useWidgetStream } from './useWidgetStream.js';
import type {
  StreamListener,
  StreamRealtimeEvent,
  StreamStatusListener,
  StreamTransport,
} from './stream-types.js';

interface Row {
  id: number;
  label: string;
}
const getKey = (row: Row): number => row.id;

function makeFakeTransport() {
  const subs = new Map<string, { listener: StreamListener; onStatus?: StreamStatusListener | undefined }>();
  let unsubscribes = 0;
  const transport: StreamTransport = {
    subscribe(channel, listener, onStatus) {
      subs.set(channel, { listener, onStatus });
      onStatus?.(true);
      return () => {
        subs.delete(channel);
        unsubscribes += 1;
      };
    },
  };
  return {
    transport,
    emit(channel: string, data: unknown, type = 'record.create'): void {
      const event: StreamRealtimeEvent = { channel, type, data, ts: '2026-07-14T00:00:00Z' };
      act(() => subs.get(channel)?.listener(event));
    },
    setStatus(channel: string, connected: boolean): void {
      act(() => subs.get(channel)?.onStatus?.(connected));
    },
    channels: (): string[] => [...subs.keys()],
    unsubscribes: (): number => unsubscribes,
  };
}

describe('useWidgetStream', () => {
  it('subscribes to the channel, seeds the snapshot, and reports connected', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({
        channel: 'widget-data:conn_1:public.orders',
        snapshot: [{ id: 1, label: 'seed' }],
        getKey,
        transport: fake.transport,
      }),
    );
    expect(fake.channels()).toEqual(['widget-data:conn_1:public.orders']);
    expect(result.current.items).toEqual([{ id: 1, label: 'seed' }]);
    expect(result.current.unread).toBe(0);
    expect(result.current.connected).toBe(true);
  });

  it('applies create events newest-first and counts them unread', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({ channel: 'c', getKey, transport: fake.transport }),
    );
    fake.emit('c', { type: 'record.create', row: { id: 2, label: 'two' } });
    fake.emit('c', { type: 'record.create', row: { id: 3, label: 'three' } });
    expect(result.current.items.map((r) => r.id)).toEqual([3, 2]);
    expect(result.current.unread).toBe(2);
  });

  it('markRead resets unread; the items stay', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({ channel: 'c', getKey, transport: fake.transport }),
    );
    fake.emit('c', { type: 'record.create', row: { id: 1, label: 'a' } });
    expect(result.current.unread).toBe(1);
    act(() => result.current.markRead());
    expect(result.current.unread).toBe(0);
    expect(result.current.items).toHaveLength(1);
  });

  it('reconciles an optimistic prepend with the server echo (no duplicate, no unread)', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({ channel: 'c', getKey, transport: fake.transport }),
    );
    act(() => result.current.prepend({ id: 7, label: 'optimistic' }));
    expect(result.current.items).toEqual([{ id: 7, label: 'optimistic' }]);
    expect(result.current.unread).toBe(0);
    fake.emit('c', { type: 'record.update', row: { id: 7, label: 'confirmed' } });
    expect(result.current.items).toEqual([{ id: 7, label: 'confirmed' }]);
    expect(result.current.unread).toBe(0);
  });

  it('removes an item on a delete event (masked pre-image → key)', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({
        channel: 'c',
        snapshot: [{ id: 5, label: 'target' }, { id: 4, label: 'keep' }],
        getKey,
        transport: fake.transport,
      }),
    );
    fake.emit('c', { type: 'record.delete', row: { id: 5, label: 'target' } }, 'record.delete');
    expect(result.current.items.map((r) => r.id)).toEqual([4]);
  });

  it('lets go of a row whose key comes with no row: it was this reader\'s and is a colleague\'s now', () => {
    const fake = makeFakeTransport();
    const channel = 'widget-data:conn_1:public.deals';
    const { result } = renderHook(() =>
      useWidgetStream<Row>({ channel, snapshot: [{ id: 2, label: 'theirs now' }, { id: 1, label: 'still mine' }], getKey, transport: fake.transport }),
    );
    // The key as the server sends it: an object of the key's one column, here as text though the widget's key is a number.
    fake.emit(channel, { type: 'record.update', pk: { id: '2' }, row: null, gone: true }, 'record.update');
    expect(result.current.items).toEqual([{ id: 1, label: 'still mine' }]);
    // A key that names nothing held, a frame with no key at all, and a key of two columns change nothing.
    fake.emit(channel, { type: 'record.update', pk: { id: 9 }, row: null, gone: true }, 'record.update');
    fake.emit(channel, { type: 'record.update', pk: null, row: null, changed: true }, 'record.update');
    fake.emit(channel, { type: 'record.update', pk: { a: 1, b: 1 }, row: null, gone: true }, 'record.update');
    expect(result.current.items).toEqual([{ id: 1, label: 'still mine' }]);
  });

  it('keeps a row when a frame names it with no row and no mark: a file attached to a record is not the record leaving', () => {
    const fake = makeFakeTransport();
    const channel = 'widget-data:conn_1:public.deals';
    const { result } = renderHook(() => useWidgetStream<Row>({ channel, snapshot: [{ id: 2, label: 'has a new file' }, { id: 1, label: 'another' }], getKey, transport: fake.transport }));
    fake.emit(channel, { type: 'record.attachments', pk: { id: 2 }, row: null }, 'record.attachments');
    fake.emit(channel, { type: 'record.update', pk: { id: 2 }, row: null }, 'record.update');
    expect(result.current.items).toEqual([{ id: 2, label: 'has a new file' }, { id: 1, label: 'another' }]);
  });

  it('holds a let-go while paused and applies it on resume, in order with what else came', () => {
    const fake = makeFakeTransport();
    const channel = 'widget-data:conn_1:public.deals';
    const { result } = renderHook(() => useWidgetStream<Row>({ channel, snapshot: [{ id: 1, label: 'mine' }], getKey, transport: fake.transport }));
    act(() => result.current.setPaused(true));
    fake.emit(channel, { type: 'record.create', pk: { id: 3 }, row: { id: 3, label: 'new' } });
    fake.emit(channel, { type: 'record.update', pk: { id: 1 }, row: null, gone: true }, 'record.update');
    expect(result.current.items).toEqual([{ id: 1, label: 'mine' }]);
    act(() => result.current.setPaused(false));
    expect(result.current.items).toEqual([{ id: 3, label: 'new' }]);
  });

  it('pauses: incoming events are held and counted, then flushed on resume', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({ channel: 'c', getKey, transport: fake.transport }),
    );
    act(() => result.current.setPaused(true));
    fake.emit('c', { type: 'record.create', row: { id: 1, label: 'a' } });
    fake.emit('c', { type: 'record.create', row: { id: 2, label: 'b' } });
    // Feed frozen, but the badge counts the held items.
    expect(result.current.items).toHaveLength(0);
    expect(result.current.unread).toBe(2);
    act(() => result.current.setPaused(false));
    expect(result.current.items.map((r) => r.id)).toEqual([2, 1]);
    expect(result.current.unread).toBe(2);
  });

  it('while paused, a delete is held (feed frozen) and applied on resume', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({
        channel: 'c',
        snapshot: [{ id: 5, label: 'target' }, { id: 4, label: 'keep' }],
        getKey,
        transport: fake.transport,
      }),
    );
    act(() => result.current.setPaused(true));
    fake.emit('c', { type: 'record.delete', row: { id: 5, label: 'target' } }, 'record.delete');
    // Frozen: the row is still visible while paused, and a removal is not unread.
    expect(result.current.items.map((r) => r.id)).toEqual([5, 4]);
    expect(result.current.unread).toBe(0);
    act(() => result.current.setPaused(false));
    // Held removal replays on resume.
    expect(result.current.items.map((r) => r.id)).toEqual([4]);
  });

  it('replays held create-then-delete of the same key in order on resume', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({ channel: 'c', getKey, transport: fake.transport }),
    );
    act(() => result.current.setPaused(true));
    fake.emit('c', { type: 'record.create', row: { id: 9, label: 'new' } });
    fake.emit('c', { type: 'record.delete', row: { id: 9, label: 'new' } }, 'record.delete');
    expect(result.current.items).toHaveLength(0);
    act(() => result.current.setPaused(false));
    // Upsert then remove ⇒ nets to empty (order preserved).
    expect(result.current.items).toHaveLength(0);
  });

  it('unsubscribes on unmount and when the channel changes', () => {
    const fake = makeFakeTransport();
    const { rerender, unmount } = renderHook(
      ({ channel }: { channel: string }) =>
        useWidgetStream<Row>({ channel, getKey, transport: fake.transport }),
      { initialProps: { channel: 'c1' } },
    );
    expect(fake.channels()).toEqual(['c1']);
    rerender({ channel: 'c2' });
    expect(fake.channels()).toEqual(['c2']);
    expect(fake.unsubscribes()).toBe(1);
    unmount();
    expect(fake.unsubscribes()).toBe(2);
  });

  it('tracks connection status changes from the transport', () => {
    const fake = makeFakeTransport();
    const { result } = renderHook(() =>
      useWidgetStream<Row>({ channel: 'c', getKey, transport: fake.transport }),
    );
    expect(result.current.connected).toBe(true);
    fake.setStatus('c', false);
    expect(result.current.connected).toBe(false);
  });

  it('demo mode drives the buffer from the deterministic generator when unbound', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useWidgetStream<Row>({
          getKey: (row) => (row as unknown as { id: number }).id,
          demo: { seed: 99, intervalMs: 1000 },
        }),
      );
      expect(result.current.connected).toBe(true);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.items.length).toBeGreaterThanOrEqual(2);
      expect(result.current.unread).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
