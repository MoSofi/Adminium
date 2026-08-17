// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generated QA stories — 04-widget-registry.md 04-T17 (2). For every registered
 * Wave-1 widget, a story renders its four WidgetFrame states (skeleton · empty ·
 * error · loaded) from the widget's own deterministic `demoData(seed)`, through
 * the real WidgetHost so the frame chrome, skeleton silhouette, per-widget empty
 * copy and error Retry are all exercised exactly as in production.
 *
 * Wiring into the harnesses:
 *   - a11y: the workspace Storybook loads `@storybook/addon-a11y` (axe) globally,
 *     so every story below gets an automatic axe pass in the a11y panel / CI.
 *   - VRT matrix: `tags: ['vrt']` opts these stories into the existing Playwright
 *     matrix (packages/ui/vrt/vrt.spec.ts), which screenshots each across
 *     {light,dark} × {ltr,rtl}. The ThemeProvider decorator (.storybook/
 *     preview.tsx) applies the theme/dir globals and stamps `data-vrt-ready`.
 *     Baselines are Linux-only — capture them with `pnpm vrt:update` in the CI
 *     container (see packages/ui/playwright.config.ts + qa/README.md).
 *
 * Stories are grouped one-per-family (static named exports so Storybook's CSF
 * indexer discovers them); each renders every delivered widget in that family.
 */
import { fnv1a } from '@adminium/charts';
import type { ReactElement } from 'react';

import { deliveredIdsByFamily } from './delivered.js';
import { WidgetHost } from '../frame/WidgetHost.js';
import type { WidgetDataState } from '../frame/WidgetHost.js';
import { widgetRegistry } from '../registry/index.js';
import { qaRegistry } from './delivered.js';
import type { WidgetDefinition } from '../registry/types.js';

/**
 * Fixed reference clock for relative timestamps, just after every family's demo
 * epoch (feeds anchor 2026-07-14T12:00Z, log-table 14:30Z). Threaded through
 * `format.referenceTime` so feed/log widgets render "3h ago"-style text against
 * this pinned `now` instead of the wall clock — keeping VRT captures
 * byte-deterministic (finding: live-clock timestamps drift every screenshot).
 */
const VRT_REFERENCE_TIME = Date.UTC(2026, 6, 14, 15, 0, 0);

const meta = {
  title: 'QA/Widget States',
  // Opt every story into the VRT screenshot matrix + document the profiles.
  tags: ['vrt'],
  parameters: {
    layout: 'fullscreen',
    a11y: { element: '#storybook-root' },
    vrtMatrix: ['light-ltr', 'dark-ltr', 'light-rtl', 'dark-rtl'],
  },
};
export default meta;

const STATES: { key: string; label: string; data: (definition: WidgetDefinition) => WidgetDataState }[] = [
  { key: 'skeleton', label: 'Skeleton', data: () => ({ status: 'loading' }) },
  { key: 'empty', label: 'Empty', data: () => ({ status: 'success', data: undefined }) },
  {
    key: 'error',
    label: 'Error',
    data: () => ({ status: 'error', error: new Error('COLUMN_FORBIDDEN'), refetch: () => {} }),
  },
  {
    key: 'loaded',
    label: 'Loaded',
    data: (definition) => ({ status: 'success', data: definition.demoData(fnv1a(definition.id)) }),
  },
];

/** Resolve a widget from the assembled registry (falls back to the qa registry
 * until the GREEN LOOP wires every family into the live map). */
function resolve(id: string): WidgetDefinition | undefined {
  return widgetRegistry.get(id) ?? qaRegistry.get(id);
}

function StateCell({ definition, stateKey }: { definition: WidgetDefinition; stateKey: string }): ReactElement {
  const state = STATES.find((s) => s.key === stateKey)!;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-xs font-medium text-fg-muted">{state.label}</span>
      <div className="min-h-40 rounded-lg border border-border bg-surface p-3">
        <WidgetHost
          widgetId={definition.id}
          instanceId={`qa-${definition.id}-${stateKey}`}
          config={{
            title: definition.id,
            emptyState: { titleKey: 'No data for this range' },
            // Pin relative timestamps so feed/log VRT captures don't drift.
            format: { referenceTime: VRT_REFERENCE_TIME },
          }}
          data={state.data(definition)}
          registry={qaRegistry}
        />
      </div>
    </div>
  );
}

function WidgetStatesRow({ definition }: { definition: WidgetDefinition }): ReactElement {
  return (
    <section className="flex flex-col gap-2" data-qa-widget={definition.id}>
      <h3 className="text-body-sm font-semibold text-fg">
        {definition.id}
        <span className="ms-2 font-normal text-fg-muted">· {definition.family}</span>
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATES.map((state) => (
          <StateCell key={state.key} definition={definition} stateKey={state.key} />
        ))}
      </div>
    </section>
  );
}

function FamilyGallery({ family }: { family: string }): ReactElement {
  const ids = deliveredIdsByFamily()[family] ?? [];
  return (
    <div className="flex flex-col gap-8 p-6">
      {ids.map((id) => {
        const definition = resolve(id);
        return definition ? <WidgetStatesRow key={id} definition={definition} /> : null;
      })}
    </div>
  );
}

/** Every KPI widget in its four WidgetFrame states. */
export const KpiStates = { render: () => <FamilyGallery family="kpi" /> };
/** Every charts widget in its four WidgetFrame states. */
export const ChartsStates = { render: () => <FamilyGallery family="charts" /> };
/** Every tables/lists widget in its four WidgetFrame states. */
export const TablesStates = { render: () => <FamilyGallery family="tables" /> };
/** Every feeds/activity widget in its four WidgetFrame states. */
export const FeedsStates = { render: () => <FamilyGallery family="feeds" /> };
