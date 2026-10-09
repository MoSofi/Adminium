// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The work bar's levels and the page's one view or two, driven with numbers:
 * the unit tests' DOM lays nothing out, so the rule is one pure function and
 * the real bar is measured in a browser.
 */
import { describe, expect, it } from 'vitest';

import { CHAT_WIDTH, FOLDED_NEED_GUESS, firstLevel, LEVEL_SLACK, nextLevel, views, type BarLevel, type LevelState } from './barLevel.js';

/** A bar whose content needs `needs[level]` at each level, laid out at `width` until it settles. */
function settle(state: LevelState, width: number, needs: readonly number[], key = state.key): { state: LevelState; steps: BarLevel[] } {
  const steps: BarLevel[] = [];
  let now = state;
  for (let round = 0; round < 12; round += 1) {
    const wants = needs[now.key === key ? now.level : 0] ?? 0;
    const next = nextLevel(now, { width, clientWidth: width, scrollWidth: Math.max(width, wants), key });
    if (next === now) return { state: now, steps };
    steps.push(next.level);
    now = next;
  }
  throw new Error(`the bar never settled at ${String(width)}: ${steps.join(',')}`);
}

// What the design's own bar needs at each level, in English, as its frames measure (each frame's width less
// what its address box has over its least, 180): two sides, then three. Two rows need next to nothing.
const TWO = [997, 983, 854, 714, 0];
const THREE = [1122, 1080, 854, 714, 0];

describe('the work bar’s level', () => {
  it('lands where the design draws each of its frames', () => {
    const frames: [string, number, readonly number[], BarLevel][] = [
      ['1 · two sides, a work area of 1059', 1059, TWO, 0],
      ['4 · three sides, 1120', 1120, THREE, 1],
      ['11c · 1080', 1080, THREE, 1],
      ['11d · 900', 900, THREE, 2],
      ['11a · two views at 1024', 1024, THREE, 2],
      ['11e · 744', 744, THREE, 3],
      ['11b · two views at 768', 768, THREE, 3],
      ['13a · dark, 1059', 1059, TWO, 0],
      ['14 · right to left, 1059', 1059, TWO, 0],
      ['12a · a phone, 390', 390, THREE, 4],
    ];
    for (const [name, width, needs, level] of frames) expect(settle(firstLevel('k'), width, needs).state.level, name).toBe(level);
  });

  it('goes up when the bar overflows, writing down what the level needed, and stays when it fits', () => {
    const start = firstLevel('k');
    expect(nextLevel(start, { width: 1200, clientWidth: 1200, scrollWidth: 1200, key: 'k' })).toBe(start);
    // A pixel of rounding is not an overflow.
    expect(nextLevel(start, { width: 1200, clientWidth: 1200, scrollWidth: 1201, key: 'k' })).toBe(start);
    const up = nextLevel(start, { width: 1000, clientWidth: 1000, scrollWidth: 1122, key: 'k' });
    expect(up).toEqual({ level: 1, need: [1122, null, null, null], key: 'k' });
    const { state, steps } = settle(start, 800, THREE);
    expect(steps).toEqual([1, 2, 3]);
    expect(state.need).toEqual([1122, 1080, 854, null]);
    // Narrower than the most folded bar (longer words than English, or a narrow pane): two rows, which always fit.
    const rows = settle(state, 700, THREE).state;
    expect(rows).toEqual({ level: 4, need: [1122, 1080, 854, 714], key: 'k' });
    expect(nextLevel(rows, { width: 300, clientWidth: 300, scrollWidth: 340, key: 'k' })).toBe(rows);
    // And one row again only past what that row needed.
    expect(settle(rows, 714 + LEVEL_SLACK - 1, THREE).state.level).toBe(4);
    expect(settle(rows, 714 + LEVEL_SLACK, THREE).state.level).toBe(3);
  });

  it('comes down only past what the level below needed and a few pixels, so it never flaps at the edge', () => {
    const at2 = settle(firstLevel('k'), 1000, THREE).state;
    expect(at2.level).toBe(2);
    // Wider, and not yet wide enough for level 1 with its slack: it stays, at every width on the way.
    for (const width of [1050, 1079, 1080, 1080 + LEVEL_SLACK - 1]) expect(settle(at2, width, THREE).state.level, String(width)).toBe(2);
    const down = settle(at2, 1080 + LEVEL_SLACK, THREE);
    expect(down.state.level).toBe(1);
    expect(down.steps).toEqual([1]);
    // And at the very width it came down at, it does not go back up.
    expect(settle(down.state, 1080 + LEVEL_SLACK, THREE).steps).toEqual([]);
    // Dragged back and forth across the edge: one change each way, never two in one layout.
    let now = down.state;
    const seen: BarLevel[] = [];
    for (const width of [1077, 1082, 1077, 1088, 1077, 1088]) {
      now = settle(now, width, THREE).state;
      seen.push(now.level);
    }
    expect(seen).toEqual([2, 2, 2, 1, 2, 1]);
    // All the way open again.
    expect(settle(at2, 1400, THREE).state.level).toBe(0);
  });

  it('forgets what it measured when the language, the sides, the chip’s words or the tab change', () => {
    const at3 = settle(firstLevel('en|3|Seen as: owner|preview'), 800, THREE).state;
    expect(at3.level).toBe(3);
    for (const key of ['de|3|Seen as: owner|preview', 'en|2|Seen as: owner|preview', 'en|3|Seen as: Cook, Cashier|preview', 'en|3|Seen as: owner|architecture']) {
      expect(nextLevel(at3, { width: 800, clientWidth: 800, scrollWidth: 800, key }), key).toEqual(firstLevel(key));
    }
    // German words need more: the same width lands a level higher than English did.
    const german = [1190, 1150, 920, 780, 0];
    expect(settle(firstLevel('en'), 1100, THREE).state.level).toBe(1);
    expect(settle(firstLevel('de'), 1100, german).state.level).toBe(2);
  });
});

describe('one view or two', () => {
  const at = (window: number, over: Partial<{ need: number; wanted: number; two: boolean }> = {}) => views({ window, need: FOLDED_NEED_GUESS, wanted: CHAT_WIDTH.start, two: false, ...over });

  it('keeps the chat beside the work area at 1100, and makes two views at 1024', () => {
    expect(at(1100).two).toBe(false);
    expect(at(1024).two).toBe(true);
    // The edge itself: a 340 chat, the rule, and the bar at its most folded.
    expect(at(340 + 1 + 752).two).toBe(false);
    expect(at(340 + 1 + 752 - 1).two).toBe(true);
  });

  it('goes by the bar as it was measured off-screen, whatever tab shows: longer words bring two views sooner', () => {
    expect(at(1100, { need: 800 }).two).toBe(true);
    expect(at(1141, { need: 800 }).two).toBe(false);
  });

  it('comes back to one view only with a few pixels over', () => {
    for (const window of [1093, 1096, 1100]) expect(at(window, { two: true }).two, String(window)).toBe(true);
    expect(at(1093 + LEVEL_SLACK, { two: true }).two).toBe(false);
    expect(at(1093 + LEVEL_SLACK, { two: false }).two).toBe(false);
  });

  it('lets the chat give its width up as the window narrows and get it back, never under its least', () => {
    expect(at(1500).chat).toBe(380);
    expect(at(1500, { wanted: 600 }).chat).toBe(600);
    // 1300 − 1 − 752 leaves 547: a chat dragged to 600 is drawn at 547, and is 600 again when there is room.
    expect(at(1300, { wanted: 600 })).toEqual({ two: false, chat: 547, most: 547 });
    expect(at(1100, { wanted: 600 }).chat).toBe(347);
    expect(at(1100).chat).toBe(347);
    expect(at(1093, { wanted: 600 }).chat).toBe(340);
    expect(at(1400, { wanted: 600 }).chat).toBe(600);
    // In two views the chat is not beside anything; the number is still a sane one.
    expect(at(900).chat).toBe(340);
  });

  it('says how far the chat can be dragged now', () => {
    expect(at(1500).most).toBe(600);
    expect(at(1200).most).toBe(447);
    expect(at(1000).most).toBe(340);
  });
});
