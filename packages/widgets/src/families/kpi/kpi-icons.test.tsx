// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Every icon a metric card may name draws its own glyph. The name list and the
 * component's map are two places, so a name added to one and not the other
 * would either be refused by the schema or fall back to nothing — this walks
 * the schema's whole list and checks each one against what renders.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { KpiStatCard, kpiStatCardConfigSchema } from './KpiStatCard.js';

const noop = () => {};

/** The names the schema accepts, read from the schema itself. */
const iconNames = kpiStatCardConfigSchema.shape.iconName.unwrap().options;

function glyphOf(iconName: string): SVGElement | null {
  const config = kpiStatCardConfigSchema.parse({ format: { locale: 'en-US' }, iconName });
  const { container } = render(<KpiStatCard config={config} data={{ value: 1, prior: 1 }} instanceId={`w-${iconName}`} onEvent={noop} />);
  return container.querySelector('svg.lucide');
}

afterEach(cleanup);

describe('kpi-stat-card icons', () => {
  it('accepts the studio set: overdue money, work done, proposals, projects, a paid claim, changes, enquiries', () => {
    for (const name of ['clock-alert', 'circle-check', 'file-pen-line', 'folder-kanban', 'hand-coins', 'message-square-diff', 'inbox']) {
      expect(iconNames).toContain(name);
      // The lucide glyph of that name, not a stand-in.
      expect(glyphOf(name)?.getAttribute('class')).toContain(`lucide-${name}`);
      cleanup();
    }
  });

  it('draws a different glyph for every name it accepts', () => {
    const drawn = new Map<string, string>();
    for (const name of iconNames) {
      const svg = glyphOf(name);
      expect(svg, name).not.toBeNull();
      const shape = svg?.innerHTML ?? '';
      expect(drawn.get(shape), `${name} draws the same glyph as ${drawn.get(shape) ?? ''}`).toBeUndefined();
      drawn.set(shape, name);
      cleanup();
    }
    expect(drawn.size).toBe(iconNames.length);
  });
});
