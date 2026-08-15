/**
 * `kpi-stat-tile-compact` (annex §1) — the slim tile variant of the workhorse
 * card, for dense "power" rows of 4–6: uppercase micro-label, mono value, a tiny
 * delta chip, and a 22px 6-bar sparkline. No icon tile (that is what separates it
 * from `kpi-stat-card`). Renders only the loaded state — skeleton/empty/error
 * are WidgetFrame's job.
 */

import { DeltaPill, MonoText } from '@adminium/ui';
import { Sparkline } from '@adminium/charts';

import { computeDelta, formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asMetricDelta } from '../../lib/shapes.js';
import type { KpiStatTileCompactConfig } from './kpi-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { kpiStatTileCompactConfigSchema, kpiStatTileCompactDemoData } from './kpi-config.js';
export type { KpiStatTileCompactConfig } from './kpi-config.js';

export function KpiStatTileCompact({ config, data }: WidgetProps<KpiStatTileCompactConfig>) {
  const metric = asMetricDelta(data);
  if (metric === null) {
    return <p className="px-3 pb-3 text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  const opts = formatOptionsOf(config);
  const value = formatMetricValue(metric.value, config.metricFormat, opts);
  const delta = computeDelta(metric, config.deltaMode, config.metricFormat, opts);
  // NOT `?? config.title` — see KpiStatCard: `placement: 'grid'` means the frame
  // header already shows the title, so the fallback only ever duplicated it.
  const label = config.metricLabel;
  const spark = config.showSparkline ? metric.spark : undefined;

  return (
    <div
      className="flex h-full flex-col justify-between gap-1.5 px-3 pb-3 compact:px-2.5 compact:pb-2.5"
      data-widget="kpi-stat-tile-compact"
      data-columns={config.columns}
    >
      {label === undefined ? null : (
        <p className="truncate text-micro font-bold uppercase tracking-wide text-fg-subtle">{label}</p>
      )}
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <MonoText className="block truncate text-[19px] font-bold leading-none text-fg">{value}</MonoText>
          {delta === null ? null : (
            <DeltaPill trend={delta.trend} invertGood={config.invertDeltaGood} className="self-start">
              {delta.text}
            </DeltaPill>
          )}
        </div>
        {spark === undefined ? null : (
          <Sparkline data={spark} variant="bar" width={48} height={22} className="shrink-0" />
        )}
      </div>
    </div>
  );
}
