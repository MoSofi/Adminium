import { Badge, IconTile, MonoText, ProgressBar } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { Activity } from 'lucide-react';
import { useMemo } from 'react';

import { sloMonitorCardConfigSchema, sloMonitorCardDemoData } from './domain-ops-config.js';
import type { SloMonitorCardConfig } from './domain-ops-config.js';
import {
  OPS_TONE_BG,
  OPS_TONE_BORDER_S,
  OPS_TONE_TEXT,
  UPTIME_HEIGHT,
  UPTIME_TONE,
  budgetTone,
  countField,
  formatMs,
  formatPct,
  labelField,
  opsRowOf,
  pctField,
  uptimeStateOf,
} from './domain-ops-lib.js';
import type { SloMonitor, UptimeState } from './domain-ops-types.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `slo-monitor-card` (annex §13) — a per-service SLA card: status rule, icon
 * tile, status pill, mono endpoint, current% against target%, the trailing daily
 * uptime sparkline (height + color by Operational/Degraded/Down), a
 * threshold-colored error-budget bar, and p95 latency. Evidence: SLA Monitoring.
 *
 * DIRECTION (10-i18n-theming.md §5.5) — the sparkline here is NOT a time axis
 * island. It is a compact trailing-history glyph, ~30 undated bars with no axis,
 * no labels and no origin to align a gutter to; nothing in it anchors a reader
 * to "left = older" the way the gantt's dated canvas does. So the whole card
 * mirrors as one unit: the bar strip is a plain flex row that reverses under
 * `dir="rtl"`, keeping "newest" at the reading END in both directions — which is
 * where a reader's eye lands last, and therefore where "now" belongs. The
 * status rule rides `border-s-*` for the same reason (annex "status left-border"
 * means the START of the row, not its physical left).
 *
 * ORDERING CONTRACT: `history` arrives OLDEST → NEWEST and is rendered in that
 * order. `flex-row` + `dir="rtl"` does the mirroring; the array is never
 * reversed in JS, so LTR and RTL consume byte-identical data.
 */

export { sloMonitorCardConfigSchema, sloMonitorCardDemoData };
export type { SloMonitorCardConfig };

export interface SloMonitorCardViewProps {
  monitor: SloMonitor;
  budgetThresholds?: { warn?: number; danger?: number } | undefined;
  /** Days of history to render (the sparkline window). */
  windowDays?: number | undefined;
  locale?: string | undefined;
  targetLabel?: string | undefined;
  budgetLabel?: string | undefined;
  latencyLabel?: string | undefined;
  testId?: string | undefined;
}

/** Localized status label falls back to the raw enum (a developer fallback). */
const STATUS_FALLBACK: Record<UptimeState, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
};

export function SloMonitorCardView({
  monitor,
  budgetThresholds,
  windowDays = 30,
  locale,
  targetLabel,
  budgetLabel,
  latencyLabel,
  testId,
}: SloMonitorCardViewProps) {
  const statusTone: Tone = UPTIME_TONE[monitor.status];
  const budget = budgetTone(monitor.budget, budgetThresholds);
  // Trailing window: the LAST `windowDays` entries, so a payload carrying 90
  // days still renders the annex's 30-bar strip without the caller pre-slicing.
  const history = monitor.history.slice(-Math.max(1, windowDays));
  // A shortfall against target is the whole point of the card, so the current
  // figure is toned by whether it MET the target — not by the service's
  // instantaneous status, which can read green during a month that already
  // blew its budget.
  const meetsTarget = monitor.current >= monitor.target;

  return (
    <div
      data-widget="slo-monitor-card"
      data-testid={testId}
      data-status={monitor.status}
      className={`flex h-full flex-col gap-3 overflow-auto border-s-4 ${OPS_TONE_BORDER_S[statusTone]} px-4 pb-4`}
    >
      <div className="flex items-start gap-2.5">
        <IconTile tone={statusTone} size="sm" icon={<Activity />} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-bold text-fg">{monitor.name}</p>
          {monitor.endpoint === undefined ? null : (
            <MonoText className="block truncate text-caption text-fg-subtle">{monitor.endpoint}</MonoText>
          )}
        </div>
        <Badge tone={statusTone} dot data-part="slo-status">
          {STATUS_FALLBACK[monitor.status]}
        </Badge>
      </div>

      <div className="flex items-baseline gap-2">
        <MonoText
          data-part="slo-current"
          className={`text-h2 font-bold tabular-nums ${meetsTarget ? OPS_TONE_TEXT.pos : OPS_TONE_TEXT.danger}`}
        >
          {formatPct(monitor.current, locale, 2)}
        </MonoText>
        <span className="text-caption text-fg-subtle">
          {targetLabel ?? 'Target'} <MonoText>{formatPct(monitor.target, locale, 2)}</MonoText>
        </span>
      </div>

      {/*
        Daily uptime strip. Decorative for AT — the numbers above and the status
        pill already state the same facts in text, and 30 announced bars would
        be noise, not information.
      */}
      <div
        aria-hidden="true"
        data-testid="slo-sparkline"
        className="flex h-8 items-end gap-px"
      >
        {history.map((state, index) => (
          <span
            key={`${index}-${state}`}
            data-part="slo-day"
            data-state={state}
            className={`h-[var(--bar-h)] min-w-px flex-1 rounded-xs ${OPS_TONE_BG[UPTIME_TONE[state]]}`}
            style={{ '--bar-h': `${UPTIME_HEIGHT[state]}%` }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-caption">
          <span className="text-fg-subtle">{budgetLabel ?? 'Error budget'}</span>
          <MonoText className={`font-bold ${OPS_TONE_TEXT[budget]}`} data-part="slo-budget">
            {formatPct(monitor.budget, locale)}
          </MonoText>
        </div>
        <ProgressBar
          value={monitor.budget}
          tone={budget}
          size="sm"
          animated={false}
          label={budgetLabel ?? 'Error budget'}
        />
      </div>

      {monitor.p95 === undefined ? null : (
        <p className="text-caption text-fg-subtle">
          {latencyLabel ?? 'p95 latency'} <MonoText className="font-semibold text-fg">{formatMs(monitor.p95, locale)}</MonoText>
        </p>
      )}
    </div>
  );
}

/** Project the bound `record` onto the monitor model (config-driven columns). */
function monitorOf(config: SloMonitorCardConfig, data: unknown): SloMonitor | null {
  const row = opsRowOf(data);
  if (row === null) return null;
  const raw = row[config.historyField];
  const history = (Array.isArray(raw) ? raw : []).map(uptimeStateOf);
  return {
    name: labelField(row, config.nameField, 'Service'),
    endpoint: row[config.endpointField] === undefined ? undefined : labelField(row, config.endpointField, ''),
    target: pctField(row, config.targetField, config.target),
    current: pctField(row, config.currentField, 0),
    status: uptimeStateOf(row[config.statusField]),
    budget: pctField(row, config.budgetField, 0),
    // Latency is milliseconds, NOT a percent — it must not go through
    // `pctField`, which would clamp a real 240ms p95 down to 100.
    p95: row[config.p95Field] === undefined ? undefined : countField(row, config.p95Field, 0),
    history,
  };
}

export function SloMonitorCardWidget({ config, data }: WidgetProps<SloMonitorCardConfig>) {
  const monitor = useMemo(() => monitorOf(config, data), [config, data]);

  if (monitor === null) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? 'No monitor'}
        body={config.emptyBody ?? 'Bind a monitors table with a status and an availability column.'}
      />
    );
  }

  return (
    <SloMonitorCardView
      monitor={monitor}
      windowDays={config.windowDays}
      {...(config.budgetThresholds === undefined ? {} : { budgetThresholds: config.budgetThresholds })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.targetLabel === undefined ? {} : { targetLabel: config.targetLabel })}
      {...(config.budgetLabel === undefined ? {} : { budgetLabel: config.budgetLabel })}
      {...(config.latencyLabel === undefined ? {} : { latencyLabel: config.latencyLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
