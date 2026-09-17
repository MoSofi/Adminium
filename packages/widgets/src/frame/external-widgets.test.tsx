// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Widgets from outside the registry (`ExternalWidgetsContext.tsx`): the host's
 * resolver is asked after the registry, and its widgets get demo data the same
 * way registry widgets do.
 */
import { render, screen } from '@testing-library/react';
import { lazy } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { buildRegistry } from '../registry/index.js';
import { widgetSharedConfigSchema } from '../registry/shared-config.js';
import { defineWidget, type WidgetDefinition, type WidgetProps } from '../registry/types.js';
import { widgetMissingDefinition } from '../registry/widget-missing.js';
import { PageDashboard } from '../templates/page-dashboard/PageDashboard.js';
import { makeTestDefinition } from '../test/fixtures.js';
import { ExternalWidgetsProvider } from './ExternalWidgetsContext.js';
import { WidgetHost } from './WidgetHost.js';

function Custom({ config, data }: WidgetProps<{ title?: string | undefined }>) {
  return (
    <p data-testid="custom">
      custom {config.title ?? ''} {JSON.stringify(data)}
    </p>
  );
}

const custom: WidgetDefinition = defineWidget({
  id: 'project.sales',
  family: 'domain',
  component: lazy(async () => ({ default: Custom })),
  configSchema: widgetSharedConfigSchema.extend({ extra: z.string().optional() }),
  dataContract: 'static',
  sizing: { minW: 2, minH: 2, defaultW: 4, defaultH: 4 },
  placement: 'grid',
  skeleton: 'card',
  demoData: () => ({ demo: true }),
  // Not in the catalogue, and not read: a host widget has no info popover.
  descriptionKey: 'widgets.project.description',
});

describe('external widgets', () => {
  it('render through the host resolver when the registry lacks the id', async () => {
    const resolve = vi.fn((id: string) => (id === 'project.sales' ? custom : undefined));
    render(
      <ExternalWidgetsProvider resolve={resolve}>
        <WidgetHost
          widgetId="project.sales"
          instanceId="a"
          config={{ title: 'Q3' }}
          data={{ status: 'success', data: { rows: 1 } }}
          registry={buildRegistry([widgetMissingDefinition])}
        />
      </ExternalWidgetsProvider>,
    );
    expect((await screen.findByTestId('custom')).textContent).toBe('custom Q3 {"rows":1}');
    expect(resolve).toHaveBeenCalledWith('project.sales');
    expect(screen.getByRole('heading', { name: 'Q3' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Widget info' })).toBeNull();
  });

  it('never shadow a registry widget', async () => {
    const shadow = vi.fn(() => custom);
    const registry = buildRegistry([widgetMissingDefinition, makeTestDefinition()]);
    render(
      <ExternalWidgetsProvider resolve={shadow}>
        <WidgetHost
          widgetId="test-stat-card"
          instanceId="b"
          config={{ metricLabel: 'MRR' }}
          data={{ status: 'success', data: { value: 1, deltaPct: 0 } }}
          registry={registry}
        />
      </ExternalWidgetsProvider>,
    );
    expect(await screen.findByTestId('test-widget')).toBeDefined();
    expect(shadow).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Widget info' })).toBeDefined();
  });

  it('get their demo data on an unbound dashboard item', async () => {
    render(
      <ExternalWidgetsProvider resolve={(id) => (id === 'project.sales' ? custom : undefined)}>
        <PageDashboard layout={{ version: 1, items: [{ i: 'c', widget: 'project.sales', x: 0, y: 0, w: 4, h: 4, config: {} }] }} />
      </ExternalWidgetsProvider>,
    );
    expect((await screen.findByTestId('custom')).textContent).toBe('custom  {"demo":true}');
  });

  it('are missing without a host resolver', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <WidgetHost
        widgetId="project.sales"
        instanceId="d"
        data={{ status: 'success', data: null }}
        registry={buildRegistry([widgetMissingDefinition])}
      />,
    );
    expect(await screen.findByText(/project\.sales/)).toBeDefined();
    warn.mockRestore();
  });
});
