// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Config-schema fuzz gate — 04-widget-registry.md acceptance #4/#17 spirit /
 * 04-T17 (3): for every registered widget, generate N random VALID configs from
 * its Zod schema and assert that rendering the loaded widget with each never
 * crashes.
 *
 * Rendering goes through the shared `probeLoaded` classifier so a crash surfaces
 * as a GENUINE defect (fails the test, logs the replayable config) while a
 * widget still blocked on GREEN-LOOP barrel assembly is skipped-with-a-warning
 * (ratchet) rather than failing the pre-assembly tree. Samples are
 * byte-reproducible (seeded PRNG via `configSamples`).
 */
import { afterAll, describe, expect, it } from 'vitest';

import { deliveredDefinitions } from './delivered.js';
import { probeLoaded } from './render-probe.js';
import { configSamples } from './zod-sample.js';

const SAMPLES_PER_WIDGET = 6;

const barrelPending: string[] = [];
afterAll(() => {
  if (barrelPending.length > 0) {
     
    console.warn(
      `[qa] fuzz loaded-render skipped for ${barrelPending.length} widget(s) pending ` +
        `@adminium/charts barrel assembly: ${barrelPending.join(', ')}`,
    );
  }
});

describe('config-schema fuzz — valid configs never crash render (acceptance #4/#17)', () => {
  for (const definition of deliveredDefinitions) {
    const id = definition.id;

    it(`${id}: ${SAMPLES_PER_WIDGET} random valid configs render without crashing`, async () => {
      const configs = configSamples(definition.configSchema, id.length * 101 + 7, SAMPLES_PER_WIDGET);
      expect(configs).toHaveLength(SAMPLES_PER_WIDGET);

      for (const [index, config] of configs.entries()) {
        // Every sample must be schema-valid by construction.
        expect(definition.configSchema.safeParse(config).success).toBe(true);

        const { outcome, error } = await probeLoaded(
          definition,
          definition.demoData(index + 1),
          config,
          `fuzz-${index}`,
        );
        if (outcome === 'barrel-pending') {
          barrelPending.push(id); // ratchet — gated once the barrel is wired
          return;
        }
        if (outcome === 'crash') {
          throw new Error(
            `[qa] ${id} crashed on valid config #${index} (${error?.message ?? 'unknown'}): ${JSON.stringify(config)}`,
          );
        }
        expect(outcome).toBe('ok');
      }
    });
  }
});
