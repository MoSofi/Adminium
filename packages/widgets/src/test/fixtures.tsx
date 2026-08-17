// SPDX-License-Identifier: AGPL-3.0-only
import { lazy } from 'react';
import { z } from 'zod';

import { widgetSharedConfigSchema } from '../registry/shared-config.js';
import { defineWidget } from '../registry/types.js';
import type { WidgetDefinition, WidgetProps } from '../registry/types.js';

export const testWidgetConfigSchema = widgetSharedConfigSchema.extend({
  metricLabel: z.string().default('Total'),
  showSparkline: z.boolean().default(false),
});

export type TestWidgetConfig = z.infer<typeof testWidgetConfigSchema>;

export function TestWidgetComponent({ config, data, instanceId, onEvent }: WidgetProps<TestWidgetConfig>) {
  return (
    <div data-testid="test-widget" data-instance={instanceId}>
      <span>{config.metricLabel}</span>
      <span data-testid="test-widget-data">{JSON.stringify(data)}</span>
      <button type="button" onClick={() => onEvent({ type: 'drill-through', href: '/p/orders' })}>
        Open
      </button>
    </div>
  );
}

export function ThrowingWidgetComponent(): never {
  throw new Error('widget render exploded');
}

export function makeTestDefinition(overrides: Partial<WidgetDefinition> = {}): WidgetDefinition {
  return {
    ...defineWidget({
      id: 'test-stat-card',
      family: 'kpi',
      component: lazy(() => Promise.resolve({ default: TestWidgetComponent })),
      configSchema: testWidgetConfigSchema,
      dataContract: 'metric+delta',
      sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 3 },
      placement: 'grid',
      skeleton: 'card',
      demoData: (seed) => ({ value: seed }),
      descriptionKey: 'widgets.test.statCard.description',
    }),
    ...overrides,
  };
}
