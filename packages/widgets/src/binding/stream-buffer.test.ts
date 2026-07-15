import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STREAM_MAX,
  markStreamRead,
  removeStreamItem,
  seedStreamBuffer,
  upsertStreamItem,
  upsertStreamItems,
} from './stream-buffer.js';

interface Row {
  id: number;
  v: string;
}
const getKey = (row: Row): number => row.id;

describe('seedStreamBuffer', () => {
  it('keeps snapshot order and zeroes unread', () => {
    const state = seedStreamBuffer([{ id: 2, v: 'b' }, { id: 1, v: 'a' }]);
    expect(state.items.map((r) => r.id)).toEqual([2, 1]);
    expect(state.unread).toBe(0);
  });

  it('truncates the snapshot to max', () => {
    const state = seedStreamBuffer([{ id: 3, v: 'c' }, { id: 2, v: 'b' }, { id: 1, v: 'a' }], 2);
    expect(state.items.map((r) => r.id)).toEqual([3, 2]);
  });

  it('defaults max to DEFAULT_STREAM_MAX', () => {
    const snapshot = Array.from({ length: DEFAULT_STREAM_MAX + 10 }, (_, i) => ({ id: i, v: 'x' }));
    expect(seedStreamBuffer(snapshot).items).toHaveLength(DEFAULT_STREAM_MAX);
  });
});

describe('upsertStreamItem', () => {
  it('prepends a new item newest-first and bumps unread', () => {
    let state = seedStreamBuffer<Row>([{ id: 1, v: 'a' }]);
    state = upsertStreamItem(state, { id: 2, v: 'b' }, { getKey });
    expect(state.items.map((r) => r.id)).toEqual([2, 1]);
    expect(state.unread).toBe(1);
  });

  it('replaces an existing key in place without bumping unread or reordering', () => {
    let state = seedStreamBuffer<Row>([{ id: 2, v: 'b' }, { id: 1, v: 'a' }]);
    state = upsertStreamItem(state, { id: 1, v: 'A!' }, { getKey });
    expect(state.items).toEqual([{ id: 2, v: 'b' }, { id: 1, v: 'A!' }]);
    expect(state.unread).toBe(0);
  });

  it('makes an optimistic prepend idempotent when the server echoes the same key', () => {
    // Optimistic insert (countUnread false), then the streamed echo (same key).
    let state = seedStreamBuffer<Row>([]);
    state = upsertStreamItem(state, { id: 9, v: 'optimistic' }, { getKey, countUnread: false });
    state = upsertStreamItem(state, { id: 9, v: 'confirmed' }, { getKey });
    expect(state.items).toEqual([{ id: 9, v: 'confirmed' }]);
    expect(state.unread).toBe(0); // replacement never bumps unread
  });

  it('bounds the buffer, dropping the oldest', () => {
    let state = seedStreamBuffer<Row>([]);
    for (let i = 1; i <= 5; i += 1) state = upsertStreamItem(state, { id: i, v: 'x' }, { getKey, max: 3 });
    expect(state.items.map((r) => r.id)).toEqual([5, 4, 3]);
    expect(state.unread).toBe(5);
  });
});

describe('upsertStreamItems', () => {
  it('folds a chronological batch so the newest ends first', () => {
    const state = upsertStreamItems(seedStreamBuffer<Row>([]), [
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
      { id: 3, v: 'c' },
    ], { getKey });
    expect(state.items.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(state.unread).toBe(3);
  });
});

describe('removeStreamItem', () => {
  it('drops by key and leaves unread untouched', () => {
    const seeded = { items: [{ id: 2, v: 'b' }, { id: 1, v: 'a' }], unread: 2 };
    const state = removeStreamItem(seeded, 1, getKey);
    expect(state.items.map((r) => r.id)).toEqual([2]);
    expect(state.unread).toBe(2);
  });

  it('returns the same state when the key is absent', () => {
    const seeded = seedStreamBuffer<Row>([{ id: 1, v: 'a' }]);
    expect(removeStreamItem(seeded, 99, getKey)).toBe(seeded);
  });
});

describe('markStreamRead', () => {
  it('resets unread to zero', () => {
    const state = markStreamRead({ items: [{ id: 1, v: 'a' }], unread: 4 });
    expect(state.unread).toBe(0);
    expect(state.items).toHaveLength(1);
  });

  it('is a no-op (identity) when already read', () => {
    const seeded = seedStreamBuffer<Row>([{ id: 1, v: 'a' }]);
    expect(markStreamRead(seeded)).toBe(seeded);
  });
});
