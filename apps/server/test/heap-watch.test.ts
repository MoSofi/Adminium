// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The heap watch: a `memory` line hourly, and a warning naming the fix when
 * the heap in use comes within the headroom of Node's limit twice running —
 * the 0.3.32 test server that stopped with "heap out of memory" (plan 70 A8)
 * had 243 MB in use of a 259 MB heap from the minute it started.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { HEAP_FIRST_LOOK_MS, HEAP_LOG_EVERY_MS, HEAP_LOOK_EVERY_MS, heapIsTight, nextHeapMb, readHeap, watchHeap, type HeapReading } from '../src/heap-watch.js';

function harness(readings: HeapReading[]) {
  let clock = 0;
  let run: (() => void) | null = null;
  const scheduled: number[] = [];
  const lines: { level: 'info' | 'warn'; fields: object; message: string }[] = [];
  const log = {
    info: (fields: object, message: string) => lines.push({ level: 'info', fields, message }),
    warn: (fields: object, message: string) => lines.push({ level: 'warn', fields, message }),
  };
  let i = 0;
  const stop = watchHeap(log, {
    read: () => readings[Math.min(i++, readings.length - 1)]!,
    now: () => clock,
    schedule: (fn, ms, every) => {
      run = fn;
      scheduled.push(ms, every);
      return () => {
        run = null;
      };
    },
  });
  const tick = (ms: number) => {
    clock += ms;
    run?.();
  };
  return { lines, tick, stop, scheduled };
}

const full: HeapReading = { usedMb: 243, limitMb: 259, rssMb: 307 };
const roomy: HeapReading = { usedMb: 243, limitMb: 528, rssMb: 330 };

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
});

describe('the heap watch', () => {
  it('looks a minute after start, then every five minutes', () => {
    const h = harness([roomy]);
    stops.push(h.stop);
    expect(h.scheduled).toEqual([HEAP_FIRST_LOOK_MS, HEAP_LOOK_EVERY_MS]);
  });

  it('warns, naming the setting, when the heap is nearly full twice running, and at most hourly', () => {
    const h = harness([full]);
    stops.push(h.stop);
    h.tick(HEAP_FIRST_LOOK_MS);
    expect(h.lines.filter((line) => line.level === 'warn')).toHaveLength(0);
    h.tick(HEAP_LOOK_EVERY_MS);
    const warns = h.lines.filter((line) => line.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toContain('243 MB in use of the 259 MB');
    expect(warns[0]!.message).toContain('NODE_OPTIONS=--max-old-space-size=512');
    expect(warns[0]!.fields).toEqual({ heapUsedMb: 243, heapLimitMb: 259, rssMb: 307 });
    for (let n = 0; n < 6; n += 1) h.tick(HEAP_LOOK_EVERY_MS);
    expect(h.lines.filter((line) => line.level === 'warn')).toHaveLength(1);
    h.tick(HEAP_LOG_EVERY_MS);
    expect(h.lines.filter((line) => line.level === 'warn')).toHaveLength(2);
  });

  it('does not warn for one tight look, nor with room to spare', () => {
    const once = harness([full, roomy, full, roomy]);
    for (let n = 0; n < 4; n += 1) once.tick(HEAP_LOOK_EVERY_MS);
    once.stop();
    expect(once.lines.filter((line) => line.level === 'warn')).toHaveLength(0);
    const fine = harness([roomy]);
    stops.push(fine.stop);
    for (let n = 0; n < 4; n += 1) fine.tick(HEAP_LOOK_EVERY_MS);
    expect(fine.lines.filter((line) => line.level === 'warn')).toHaveLength(0);
  });

  it('writes the memory line hourly', () => {
    const h = harness([roomy]);
    stops.push(h.stop);
    for (let n = 0; n < 12; n += 1) h.tick(HEAP_LOOK_EVERY_MS);
    expect(h.lines.filter((line) => line.message === 'memory')).toHaveLength(1);
    h.tick(HEAP_LOOK_EVERY_MS);
    expect(h.lines.filter((line) => line.message === 'memory')).toHaveLength(2);
    expect(h.lines[0]!.fields).toEqual({ heapUsedMb: 243, heapLimitMb: 528, rssMb: 330 });
  });

  it('runs once per process: a relocated server keeps the first watch', () => {
    const first = harness([roomy]);
    const second = harness([full]);
    expect(second.stop).toBe(first.stop);
    expect(second.scheduled).toEqual([]);
    first.stop();
    const again = harness([roomy]);
    stops.push(again.stop);
    expect(again.scheduled).toHaveLength(2);
  });

  it('reads this process, and calls a heap with less than its young generation and 48 MB to spare tight', () => {
    const reading = readHeap();
    expect(reading.limitMb).toBeGreaterThan(reading.usedMb);
    expect(reading.rssMb).toBeGreaterThan(0);
    expect(heapIsTight(full)).toBe(true);
    // --max-old-space-size=256 as Node reports it: 304 MB allowed, of which 48 MB is the young generation's.
    expect(heapIsTight({ usedMb: 239, limitMb: 304, rssMb: 300 })).toBe(true);
    // --max-old-space-size=512.
    expect(heapIsTight({ usedMb: 240, limitMb: 560, rssMb: 330 })).toBe(false);
    expect(heapIsTight(roomy)).toBe(false);
  });
});

describe('the heap it suggests next', () => {
  it('is 512 MB from the floor Node picks on a small machine, then doubles', () => {
    expect(nextHeapMb(259)).toBe(512);
    expect(nextHeapMb(304)).toBe(512);
    expect(nextHeapMb(524)).toBe(1024);
    expect(nextHeapMb(1060)).toBe(2048);
  });
});
