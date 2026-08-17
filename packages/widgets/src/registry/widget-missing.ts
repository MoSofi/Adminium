// SPDX-License-Identifier: AGPL-3.0-only
import { lazy } from 'react';
import { z } from 'zod';

import { widgetSharedConfigSchema } from './shared-config.js';
import { defineWidget } from './types.js';
import type { WidgetDefinition } from './types.js';

/** Registry id of the unknown-widget fallback (04 §2.2). */
export const WIDGET_MISSING_ID = 'widget-missing';

export const widgetMissingConfigSchema = widgetSharedConfigSchema.extend({
  missingId: z.string().optional(),
});

/**
 * The `widget-missing` fallback definition — a `system`-family card naming the
 * missing id. Rendered whenever a stored page config references a registry id
 * that is not installed; it must never crash a dashboard (04 §2.2). Lazy like
 * every other widget so registry metadata stays free of component code.
 */
export const widgetMissingDefinition: WidgetDefinition = defineWidget({
  id: WIDGET_MISSING_ID,
  family: 'system',
  component: lazy(() => import('./WidgetMissingCard.js')),
  configSchema: widgetMissingConfigSchema,
  dataContract: 'static',
  sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 3 },
  placement: 'grid',
  skeleton: 'card',
  demoData: () => null,
  descriptionKey: 'widgets.system.widgetMissing.description',
});
