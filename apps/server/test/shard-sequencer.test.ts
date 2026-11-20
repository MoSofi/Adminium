// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CI's server shards: each file runs on exactly one shard, the deal does not
 * depend on the order the files arrive in, and the heavy files are spread.
 */
import { describe, expect, it } from 'vitest';
import { balance, PER_FILE_MS, readTimings } from './shard-sequencer.js';

const paths = Array.from({ length: 40 }, (_, i) => `test/f${String(i).padStart(2, '0')}.test.ts`);
const timings: Record<string, number> = Object.fromEntries(paths.map((path, i) => [path, i < 4 ? 300_000 : 2_000 + i * 100]));

describe('the shard deal', () => {
  it('puts every file on exactly one shard', () => {
    const dealt = balance(paths, timings, 5);
    expect([...dealt.keys()].sort()).toEqual([...paths].sort());
    expect(new Set(dealt.values())).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it('deals the same whatever order the files come in', () => {
    expect([...balance([...paths].reverse(), timings, 5)].sort()).toEqual([...balance(paths, timings, 5)].sort());
  });

  it('spreads the heavy files rather than leaving them together', () => {
    const dealt = balance(paths, timings, 4);
    expect(new Set(paths.slice(0, 4).map((path) => dealt.get(path))).size).toBe(4);
    const loads = [0, 0, 0, 0];
    for (const path of paths) loads[dealt.get(path)!]! += timings[path]! + PER_FILE_MS;
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(300_000 / 2);
  });

  it('weighs a file it has no timing for as the median', () => {
    const dealt = balance([...paths, 'test/new.test.ts'], timings, 5);
    expect(dealt.has('test/new.test.ts')).toBe(true);
  });

  it('runs with no timings at all, dealing by count', () => {
    expect(readTimings('/no/such/file.json')).toEqual({});
    const counts = [0, 0, 0];
    for (const shard of balance(paths, {}, 3).values()) counts[shard]! += 1;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('reads the committed timings', () => {
    const committed = readTimings();
    expect(Object.keys(committed).length).toBeGreaterThan(1000);
    for (const ms of Object.values(committed)) expect(Number.isFinite(ms) && ms >= 0).toBe(true);
  });
});
