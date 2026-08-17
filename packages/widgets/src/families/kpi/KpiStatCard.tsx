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
import { computeDelta, formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asMetricDelta } from '../../lib/shapes.js';
import type { KpiStatCardConfig } from './kpi-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { kpiStatCardConfigSchema, kpiStatCardDemoData } from './kpi-config.js';
export type { KpiStatCardConfig } from './kpi-config.js';

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
    return <p className="px-[var(--widget-pad)] pb-[var(--widget-pad)] text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  const opts = formatOptionsOf(config);
  const value = formatMetricValue(metric.value, config.metricFormat, opts);
  const delta = computeDelta(metric, config.deltaMode, config.metricFormat, opts);
  // NOT `?? config.title`: this widget is `placement: 'grid'`, so WidgetHost is
  // never frameless for it and WidgetFrame has already rendered `config.title`
  // as the card header. Falling back printed the same string twice — once in the
  // header, once here. `metricLabel` is the metric's own name ("Revenue (30d)"
  // under a "Revenue" header); with none given the header alone says it.
  const label = config.metricLabel;
  const Icon = ICONS[config.iconName];
  const spark = config.showSparkline ? metric.spark : undefined;

  return (
    <div className="flex h-full flex-col justify-between gap-2 px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="kpi-stat-card">
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
