/**
 * `kpi-stat-card` — the workhorse metric card (annex §1, 04 §11): tinted
 * icon tile, label, large mono value, optional delta pill (pos/danger tone
 * with the "down-is-good" inversion flag), optional 7–8 bar mini sparkline
 * with the last bar at full accent. Renders only the loaded state —
 * skeleton/empty/error are WidgetFrame's job.
 */

import { DeltaPill, IconTile, MonoText } from '@adminium/ui';
import { Sparkline } from '@adminium/charts';
import {
  Activity,
  CircleDollarSign,
  Database,
  Gauge,
  Package,
  ShoppingCart,
  Star,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { z } from 'zod';

import { computeDelta, formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asMetricDelta } from '../../lib/shapes.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';
import type { WidgetProps } from '../../registry/types.js';

export const kpiStatCardConfigSchema = widgetSharedConfigSchema.extend({
  /** Card label under the icon row (falls back to `title`). */
  metricLabel: z.string().optional(),
  /** Value formatting (annex §1 `format`). */
  metricFormat: z.enum(['plain', 'compact', 'currency', 'percent', 'duration']).default('plain'),
  deltaMode: z.enum(['none', 'pct', 'abs']).default('pct'),
  /** Down-is-good (costs, error rates, churn) — flips the pill tones. */
  invertDeltaGood: z.boolean().default(false),
  showSparkline: z.boolean().default(true),
  /** Curated Lucide tile icon (M4 set — full by-name lookup lands with the builder). */
  iconName: z
    .enum(['activity', 'dollar', 'users', 'cart', 'gauge', 'database', 'zap', 'star', 'package', 'trending'])
    .default('activity'),
  iconTone: z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']).default('accent'),
});

export type KpiStatCardConfig = z.infer<typeof kpiStatCardConfigSchema>;

const ICONS = {
  activity: Activity,
  dollar: CircleDollarSign,
  users: Users,
  cart: ShoppingCart,
  gauge: Gauge,
  database: Database,
  zap: Zap,
  star: Star,
  package: Package,
  trending: TrendingUp,
} as const;

export function KpiStatCard({ config, data }: WidgetProps<KpiStatCardConfig>) {
  const metric = asMetricDelta(data);
  if (metric === null) {
    return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  const opts = formatOptionsOf(config);
  const value = formatMetricValue(metric.value, config.metricFormat, opts);
  const delta = computeDelta(metric, config.deltaMode, config.metricFormat, opts);
  const label = config.metricLabel ?? config.title;
  const Icon = ICONS[config.iconName];
  const spark = config.showSparkline ? metric.spark : undefined;

  return (
    <div className="flex h-full flex-col justify-between gap-2 px-4 pb-4 compact:px-3 compact:pb-3" data-widget="kpi-stat-card">
      <div className="flex items-start justify-between gap-2">
        <IconTile tone={config.iconTone} size="md" icon={<Icon />} />
        {delta !== null && (
          <DeltaPill trend={delta.trend} invertGood={config.invertDeltaGood}>
            {delta.text}
          </DeltaPill>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {label !== undefined && (
            <p className="truncate text-body-sm text-fg-muted">{label}</p>
          )}
          <MonoText className="block text-[26px] font-bold leading-tight text-fg compact:text-[22px]">
            {value}
          </MonoText>
        </div>
        {spark !== undefined && (
          <Sparkline data={spark} variant="bar" width={72} height={26} className="shrink-0" />
        )}
      </div>
    </div>
  );
}
