/**
 * `micro-kpi-subtitle` (annex §1) — the inline header micro-KPI line recomputed
 * from live state ("3 unread · 10 total", "24 members · 8 online", "N connected ·
 * 12 available"). `placement: 'inline'`, so it renders in a page-header slot
 * rather than a grid cell and never carries WidgetFrame chrome.
 *
 * The sentence is a stored TEMPLATE with `{placeholder}` tokens resolved against
 * the bound scalars — see `interpolateTemplate` in `kpi-lib` for why an unknown
 * token degrades to the empty string rather than leaking `{token}` into the UI.
 */

import { MonoText } from '@adminium/ui';

import { formatOptionsOf } from '../../lib/format.js';
import { interpolateTemplate } from './kpi-lib.js';
import type { ScalarBag } from './kpi-lib.js';
import type { MicroKpiSubtitleConfig } from './kpi-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { microKpiSubtitleConfigSchema, microKpiSubtitleDemoData } from './kpi-config.js';
export type { MicroKpiSubtitleConfig } from './kpi-config.js';

/**
 * Every scalar the payload carries, flattened for template interpolation. The
 * annex's contract is "1–3 derived scalars over a sibling `record-list`" — the
 * host compiles them into a `single-metric` envelope whose sibling keys are the
 * other scalars, so any number/string column is addressable by name.
 */
export function scalarsOf(data: unknown): ScalarBag {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const out: ScalarBag = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function MicroKpiSubtitle({ config, data }: WidgetProps<MicroKpiSubtitleConfig>) {
  const scalars = scalarsOf(data);
  const zero = scalars[config.zeroKey];
  const isZero = typeof zero === 'number' && zero === 0;

  const text =
    isZero && config.zeroStateText !== undefined
      ? config.zeroStateText
      : interpolateTemplate(config.template, scalars, config.metricFormat, formatOptionsOf(config));

  return (
    <MonoText
      data-widget="micro-kpi-subtitle"
      data-zero={isZero}
      className="truncate text-caption text-fg-muted"
    >
      {text}
    </MonoText>
  );
}
