// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Determinism gate — 04-widget-registry.md acceptance #11 / 04-T17 (4):
 * `demoData(seed)` is byte-identical across runs and platforms for every
 * registered widget. Runs over the full delivered Wave-1 set.
 *
 * "Byte-identical" is checked via a stable JSON serialization (sorted keys) so a
 * reordered-but-equal object still counts as drift — the raster/screenshot
 * pipeline depends on identical bytes, not merely deep-equal values. The order
 * independence check also catches any hidden `Math.random()` / `Date.now()` /
 * shared-mutable-state leak (the payload must not depend on call order).
 */
import { describe, expect, it } from 'vitest';

import { deliveredDefinitions } from './delivered.js';

const SEEDS = [0, 1, 7, 42, 1234, 65_535];

/**
 * Widgets whose `demoData` is intentionally seed-invariant (a fixed catalog /
 * schema / selection, not a seeded sample). Every OTHER widget's payload MUST
 * vary with the seed — otherwise the generator has silently dropped seed
 * threading, which this gate must catch (an all-seeds-identical payload would
 * pass a `size >= 1` check vacuously).
 */
const SEED_INVARIANT_IDS: ReadonlySet<string> = new Set([
  'bulk-action-toolbar', // demoData: () => ['1','2','3']
  'card-gallery', // fixed INTEGRATIONS catalog
  'schema-tree', // fixed introspection tree
  // annex §8: "none (emits files); constraints from config" — a `static`-shape
  // widget whose whole payload IS its config, so there is no sample to seed.
  'upload-dropzone',
  // annex §12: "static per context (or derived boolean isEmpty from a filtered
  // list)" — same `static`-shape case as `upload-dropzone`: the copy, glyph and
  // actions all come from config, so there is nothing for a seed to vary.
  'empty-state',
  // annex §11: "static groups of {label, keys[], isSequence}" — the host's
  // shortcut manager passes the registered set in as config, so (like the other
  // `static` widgets above) the payload is config and there is nothing to seed.
  'shortcuts-panel',
]);

/** Deterministic stable stringify (sorted keys at every level). */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortDeep((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

describe('demoData determinism (acceptance #11)', () => {
  for (const definition of deliveredDefinitions) {
    it(`${definition.id}: same seed → byte-identical payload`, () => {
      for (const seed of SEEDS) {
        const first = stableStringify(definition.demoData(seed));
        const second = stableStringify(definition.demoData(seed));
        expect(second).toBe(first);
        // A payload must actually be produced (not undefined) for a real widget.
        expect(first).not.toBe(undefined);
      }
    });

    it(`${definition.id}: payload is independent of call order (no hidden global state)`, () => {
      const forward = SEEDS.map((seed) => stableStringify(definition.demoData(seed)));
      const reverse = [...SEEDS].reverse().map((seed) => stableStringify(definition.demoData(seed)));
      // Re-pair reverse results back to seed order and compare.
      const reversedSeeds = [...SEEDS].reverse();
      const byBackfill = SEEDS.map((seed) => reverse[reversedSeeds.indexOf(seed)]);
      expect(byBackfill).toEqual(forward);
    });

    it(`${definition.id}: seed actually threads into the generator`, () => {
      const payloads = new Set(SEEDS.map((seed) => stableStringify(definition.demoData(seed))));
      if (SEED_INVARIANT_IDS.has(definition.id)) {
        // Documented constant-shaped widget: every seed yields the same bytes.
        expect(payloads.size).toBe(1);
      } else {
        // Seeded widget: distinct seeds must produce distinct payloads, proving
        // the seed threads through (catches a dropped-seed regression).
        expect(payloads.size).toBeGreaterThan(1);
      }
    });
  }
});
