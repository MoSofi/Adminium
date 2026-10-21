// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A held row on an outbox with nowhere to write its wait: left out of each
 * batch until the wait is up, then sent like any other.
 */
import { describe, expect, it } from 'vitest';

import { createMemoryHolds } from '../src/outbox/memory-holds.js';

describe('rows held in memory', () => {
  it('leaves a held row out until its wait is up, per outbox, keeping the key as it was read', () => {
    const holds = createMemoryHolds();
    holds.hold('box_a', 7, 1_000);
    holds.hold('box_a', 'msg_9', 2_000);
    holds.hold('box_b', 7, 5_000);
    expect(holds.waiting('box_a', 500)).toEqual([7, 'msg_9']);
    expect(holds.waiting('box_b', 500)).toEqual([7]);
    // The first wait is up: that row is in the next batch again.
    expect(holds.waiting('box_a', 1_000)).toEqual(['msg_9']);
    expect(holds.waiting('box_a', 2_000)).toEqual([]);
    expect(holds.waiting('box_c', 0)).toEqual([]);
  });

  it('holds a row again with its new wait, and names at most the limit asked', () => {
    const holds = createMemoryHolds();
    holds.hold('box', 1, 100);
    holds.hold('box', 1, 900);
    expect(holds.waiting('box', 500)).toEqual([1]);
    for (let n = 2; n <= 10; n += 1) holds.hold('box', n, 900);
    expect(holds.waiting('box', 500, 3)).toHaveLength(3);
  });
});
