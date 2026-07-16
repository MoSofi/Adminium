/**
 * The framework-free leaf of the `feeds` family (annex §4): the deterministic
 * seeded PRNG, the fixed demo epoch, and the day constant the demo payloads and
 * the time-bucketing share. No React, no @adminium/ui — nothing here can pull a
 * component into a chunk.
 *
 * WHY THIS IS SPLIT OUT OF `feed-lib`: `feed-lib.tsx` also exports the
 * `FeedSentence` / `RelativeTime` JSX elements, so the pure `feeds-config`
 * module (which the registry's eager metadata graph reaches) cannot import from
 * it without dragging those components — and their @adminium/ui deps — into the
 * eager chunk (04 §2.3, acceptance #3). `feed-lib.tsx` re-exports everything
 * here, so existing `./feed-lib.js` import points stay stable.
 */

/** Mulberry32 — the repo's deterministic seeded PRNG (see tables/demo-data.ts). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick from a non-empty tuple. */
export function pickFrom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

/** Fixed demo epoch so `demoData(seed)` is byte-identical across runs (04 §7.7). */
export const DEMO_EPOCH = Date.UTC(2026, 6, 14, 12, 0, 0);

/** One day in ms — demo timestamp offsets + the notification day-bucketing. */
export const MS_DAY = 86_400_000;
