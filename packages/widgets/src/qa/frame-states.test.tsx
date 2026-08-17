// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Four-state gate — 04-widget-registry.md acceptance #4 / 04-T17 (2):
 * every registered widget renders all four WidgetFrame states through
 * WidgetHost with the correct skeleton silhouette, per-widget empty copy, and a
 * working error Retry that re-issues the query. Runs over the full delivered
 * Wave-1 set (each in an isolated single-widget registry).
 *
 * A `loaded`-state render that throws inside the widget is caught by the
 * WidgetErrorBoundary and surfaces here as an unexpected `role="alert"` — so
 * this suite also doubles as a "loaded render never crashes on demoData" gate.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { deliveredDefinitions } from './delivered.js';
import { defaultConfig, probeLoaded } from './render-probe.js';
import { WidgetHost } from '../frame/WidgetHost.js';
import { buildRegistry } from '../registry/index.js';
import type { WidgetDefinition } from '../registry/types.js';

afterEach(cleanup);

/** Widgets whose loaded body can't render until the GREEN LOOP wires barrels. */
const barrelPending: string[] = [];
afterAll(() => {
  if (barrelPending.length > 0) {
     
    console.warn(
      `[qa] loaded-state gate skipped for ${barrelPending.length} widget(s) pending ` +
        `@adminium/charts barrel assembly: ${barrelPending.join(', ')}`,
    );
  }
});

function singleRegistry(definition: WidgetDefinition): ReadonlyMap<string, WidgetDefinition> {
  return buildRegistry([definition]);
}

describe('WidgetFrame four states per widget (acceptance #4)', () => {
  for (const definition of deliveredDefinitions) {
    const registry = singleRegistry(definition);
    const id = definition.id;

    it(`${id}: skeleton state shows the '${definition.skeleton}' silhouette`, () => {
      const { unmount } = render(
        <WidgetHost widgetId={id} instanceId={`${id}-load`} data={{ status: 'loading' }} registry={registry} />,
      );
      expect(document.querySelector(`[data-skeleton-variant="${definition.skeleton}"]`)).not.toBeNull();
      unmount();
    });

    it(`${id}: empty state shows the per-widget empty copy`, () => {
      const emptyTitle = `qa-empty-${id}`;
      const { unmount } = render(
        <WidgetHost
          widgetId={id}
          instanceId={`${id}-empty`}
          config={{ emptyState: { titleKey: emptyTitle } }}
          data={{ status: 'success', data: undefined }}
          registry={registry}
        />,
      );
      expect(screen.getByText(emptyTitle)).toBeTruthy();
      unmount();
    });

    it(`${id}: error state shows an alert and a Retry that re-issues the query`, () => {
      const refetch = vi.fn();
      const { unmount } = render(
        <WidgetHost
          widgetId={id}
          instanceId={`${id}-err`}
          data={{ status: 'error', error: new Error('QA_FORBIDDEN'), refetch }}
          registry={registry}
        />,
      );
      expect(screen.getByRole('alert')).toBeTruthy();
      const retry = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retry);
      expect(refetch).toHaveBeenCalledTimes(1);
      unmount();
    });

    it(`${id}: loaded body renders without crashing`, async () => {
      const { outcome, error } = await probeLoaded(definition, definition.demoData(7), defaultConfig(definition));
      if (outcome === 'barrel-pending') {
        barrelPending.push(id); // ratchet: gated once the barrel is assembled
        return;
      }
      if (outcome === 'crash') {
        throw new Error(`[qa] ${id} crashed rendering its loaded body: ${error?.message ?? 'unknown'}`);
      }
      expect(outcome).toBe('ok');
    });
  }
});
