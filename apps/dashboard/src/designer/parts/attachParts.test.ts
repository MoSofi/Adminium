// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a tall picture is cut for a model to read: a provider shrinks a whole
 * page in one picture until its layout no longer reads.
 */
import { describe, expect, it } from 'vitest';

import { PART_HEIGHT, PART_OVERLAP, PART_WIDTH, PARTS_MAX, partPlan } from './attach.js';

describe('cutting a tall picture into parts', () => {
  it('leaves a picture whole when it is not tall', () => {
    expect(partPlan(1600, 900)).toBeNull();
    expect(partPlan(800, 1400)).toBeNull();
    expect(partPlan(0, 0)).toBeNull();
  });

  it('cuts a full page (1600 × 6894) into five parts, each a part wide, the last ending at its foot', () => {
    const plan = partPlan(1600, 6894);
    expect(plan?.width).toBe(PART_WIDTH);
    expect(plan?.parts.map((part) => part.top)).toEqual([0, 976, 1952, 2928, 3802]);
    expect(plan?.parts.every((part) => part.height === PART_HEIGHT)).toBe(true);
    // The foot of the picture, as it is drawn (6894 × 0.7).
    const last = plan?.parts.at(-1);
    expect((last?.top ?? 0) + (last?.height ?? 0)).toBe(Math.round(6894 * 0.7));
  });

  it('never draws a picture larger than it is, and has each part begin above where the one before ended', () => {
    const plan = partPlan(700, 3000);
    expect(plan?.scale).toBe(1);
    expect(plan?.width).toBe(700);
    const parts = plan?.parts ?? [];
    for (let index = 1; index < parts.length; index += 1) {
      const before = parts[index - 1] as { top: number; height: number };
      expect((parts[index] as { top: number }).top).toBeLessThanOrEqual(before.top + before.height - PART_OVERLAP);
    }
  });

  it('draws a picture too tall for eight parts smaller, until eight hold all of it', () => {
    const plan = partPlan(1200, 40_000);
    expect(plan?.parts).toHaveLength(PARTS_MAX);
    const last = plan?.parts.at(-1);
    expect((last?.top ?? 0) + (last?.height ?? 0)).toBe(Math.round(40_000 * (plan?.scale ?? 0)));
    expect(plan?.parts[0]?.top).toBe(0);
  });
});
