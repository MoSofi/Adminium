import { describe, expect, it, vi } from 'vitest';

import {
  DEMO_STREAM_BASE_MS,
  DEMO_STREAM_STEP_MS,
  createDemoStreamTransport,
  demoStreamEvent,
  demoStreamRecord,
  demoStreamRecords,
} from './demo-stream.js';
import type { StreamRealtimeEvent } from './stream-types.js';

describe('demoStreamRecords determinism', () => {
  it('is byte-identical across runs for the same seed (04 §7.7)', () => {
    const a = demoStreamRecords(1234, 12);
    const b = demoStreamRecords(1234, 12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('varies with the seed', () => {
    expect(JSON.stringify(demoStreamRecords(1, 8))).not.toBe(JSON.stringify(demoStreamRecords(2, 8)));
  });

  it('returns newest-first by default and oldest-first with order asc', () => {
    const desc = demoStreamRecords(7, 4, 'desc');
    const asc = demoStreamRecords(7, 4, 'asc');
    expect(desc.map((r) => r.id)).toEqual([4, 3, 2, 1]);
    expect(asc.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('derives timestamps from the fixed base + index step (no Date.now)', () => {
    expect(demoStreamRecord(9, 0).ts).toBe(new Date(DEMO_STREAM_BASE_MS).toISOString());
    expect(demoStreamRecord(9, 3).ts).toBe(new Date(DEMO_STREAM_BASE_MS + 3 * DEMO_STREAM_STEP_MS).toISOString());
  });

  it('produces plausible, well-formed records', () => {
    const record = demoStreamRecord(42, 5);
    expect(record.id).toBe(6);
    expect(typeof record.actor).toBe('string');
    expect(typeof record.action).toBe('string');
    expect(record.resource.length).toBeGreaterThan(0);
  });
});

describe('demoStreamEvent', () => {
  it('wraps a record as a record.create realtime event', () => {
    const event = demoStreamEvent('widget-data:demo:x', demoStreamRecord(1, 0));
    expect(event.channel).toBe('widget-data:demo:x');
    expect(event.type).toBe('record.create');
    expect((event.data as { row: { id: number } }).row.id).toBe(1);
  });
});

describe('createDemoStreamTransport', () => {
  it('emits the deterministic sequence on its interval and reports connected', () => {
    const ticks: Array<() => void> = [];
    const setIntervalSpy = vi.fn((cb: () => void) => {
      ticks.push(cb);
      return 1;
    });
    const clearIntervalSpy = vi.fn();
    const transport = createDemoStreamTransport({
      seed: 55,
      setInterval: setIntervalSpy,
      clearInterval: clearIntervalSpy,
    });

    const seen: StreamRealtimeEvent[] = [];
    const status: boolean[] = [];
    const unsubscribe = transport.subscribe('widget-data:demo:demo.events', (e) => seen.push(e), (c) => status.push(c));

    expect(status).toEqual([true]);
    const tick = ticks[0];
    tick?.();
    tick?.();
    expect(seen.map((e) => (e.data as { row: { id: number } }).row.id)).toEqual([1, 2]);
    expect(seen[0]?.data).toEqual({ type: 'record.create', row: demoStreamRecord(55, 0) });

    unsubscribe();
    expect(clearIntervalSpy).toHaveBeenCalledWith(1);
    expect(status).toEqual([true, false]);
  });
});
