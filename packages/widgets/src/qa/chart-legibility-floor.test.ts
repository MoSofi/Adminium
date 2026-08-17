// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chart resize floor gate.
 *
 * Below the `lg` breakpoint `DashboardGrid` reflows to a single column and every
 * column span carries an `lg:` prefix, so `minW` is INERT on tablet and phone —
 * exactly where legibility is most at risk. `minH` is the only floor that binds
 * there, which makes it the one number worth gating.
 *
 * 4 half-units = 4 × 40px + 3 × 14px of gap = 202px. That is the smallest box
 * that fits the card's 18px padding, a 14px title, and a plot area tall enough
 * to read — below it the axis labels collide with the marks. Anything genuinely
 * smaller belongs at `placement: 'inline'` (a sparkline in a table cell), not on
 * the grid, which is why the assertion is scoped to grid placement.
 */
import { describe, expect, it } from 'vitest';

import { widgetRegistry } from '../registry/index.js';

/** Half-row units; see the file header for the arithmetic. */
const MIN_GRID_CHART_H = 4;

describe('chart legibility floor', () => {
  const gridCharts = [...widgetRegistry.values()].filter(
    (definition) => definition.family === 'charts' && definition.placement === 'grid',
  );

  it('has grid-placed charts to check', () => {
    expect(gridCharts.length).toBeGreaterThan(20);
  });

  it.each(gridCharts.map((definition) => [definition.id, definition] as const))(
    '%s cannot be resized below a legible height',
    (_id, definition) => {
      expect(definition.sizing.minH).toBeGreaterThanOrEqual(MIN_GRID_CHART_H);
    },
  );

  it('never lets a default land below its own floor', () => {
    for (const definition of gridCharts) {
      expect(definition.sizing.defaultH).toBeGreaterThanOrEqual(definition.sizing.minH);
      expect(definition.sizing.defaultW).toBeGreaterThanOrEqual(definition.sizing.minW);
    }
  });
});
