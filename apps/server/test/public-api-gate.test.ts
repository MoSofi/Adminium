// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The off switch's read cache (`public-api/enabled.ts`).
 *
 * The switch is the kill switch of the one internet-facing surface, so what
 * matters is that a flip is seen at once and that a failure reads as OFF.
 * The race pinned last: a refresh that started before `invalidate()` read the
 * old value, and used to store it for a full TTL after the operator's flip.
 */

import { describe, expect, it, vi } from 'vitest';

import { createPublicApiGate } from '../src/public-api/enabled.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('the public API gate', () => {
  it('caches a read for the TTL', async () => {
    let clock = 0;
    const read = vi.fn(async () => true);
    const gate = createPublicApiGate({ read, now: () => clock });
    expect(await gate.isEnabled()).toBe(true);
    clock += 4_999;
    expect(await gate.isEnabled()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    clock += 1;
    await gate.isEnabled();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('shares one read between concurrent callers', async () => {
    const parked = deferred<boolean>();
    const read = vi.fn(() => parked.promise);
    const gate = createPublicApiGate({ read });
    const burst = Array.from({ length: 5 }, () => gate.isEnabled());
    parked.resolve(true);
    expect(await Promise.all(burst)).toEqual([true, true, true, true, true]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('fails closed, and does not cache the failure', async () => {
    const read = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('meta store down'))
      .mockResolvedValue(true);
    const gate = createPublicApiGate({ read });
    expect(await gate.isEnabled()).toBe(false);
    expect(await gate.isEnabled()).toBe(true);
  });

  it('invalidate() makes the next call read again', async () => {
    let setting = true;
    const gate = createPublicApiGate({ read: async () => setting });
    expect(await gate.isEnabled()).toBe(true);
    setting = false;
    gate.invalidate();
    expect(await gate.isEnabled()).toBe(false);
  });

  it('a read in flight during invalidate() neither answers later callers nor fills the cache', async () => {
    let setting = true;
    const parked = deferred<boolean>();
    const read = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => parked.promise)
      .mockImplementation(async () => setting);
    const gate = createPublicApiGate({ read });

    const before = gate.isEnabled();
    // The operator switches the API off while that read is still out.
    setting = false;
    gate.invalidate();
    const after = gate.isEnabled();
    parked.resolve(true);

    expect(await before).toBe(true);
    expect(await after).toBe(false);
    // And the stale read did not land in the cache behind them.
    expect(await gate.isEnabled()).toBe(false);
  });
});
