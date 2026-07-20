/**
 * `kpi` family stories (annex §1) — the complete 10-id slice: each widget's
 * loaded variants, the four WidgetFrame states through WidgetHost (acceptance
 * #4), and light/dark × LTR/RTL matrices with REAL geometry mirroring
 * (acceptance #9). Widgets resolve through a LOCAL registry override so the
 * stories work before the green loop merges the definitions into the global
 * map. Payloads are the same seeded generators `demoData` uses.
 *
 * WHAT "REAL MIRRORING" MEANS FOR THIS FAMILY. The RTL frames set `dir="rtl"`
 * so the logical chrome genuinely flips: the stat card's icon tile and its delta
 * pill swap ends, the stat pair's `border-s` divider moves and the two metrics
 * change sides, the hero's goal caption and its progress fill reverse, the
 * gauges' captions/footers/cluster grid reorder, and the mono values stay
 * `tabular-nums`-aligned with Latin digits (data-context numerals, 10-i18n §4.2).
 *
 * The gauge CANVASES deliberately do NOT mirror — a ring sweep and a speedometer
 * arc are rotational, not directional, exactly like the donut (see the policy
 * note in `kpi-lib.ts`, and @adminium/charts `geometry/radialBar.ts` which
 * states the same rule verbatim). The RTL gauge frames exist to prove precisely
 * that: the chrome flips, the needle does not.
 */
import type { ReactNode } from 'react';

import { kpiWidgetDefinitions } from './definitions.js';
import {
  autoInsightsDemoData,
  gaugeArcDemoData,
  gaugeRingDemoData,
  kpiStatCardDemoData,
  kpiStatTileCompactDemoData,
  metricHeroDemoData,
  microKpiSubtitleDemoData,
  periodComparisonDemoData,
  statPairCardDemoData,
  usageMeterDemoData,
} from './kpi-config.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...kpiWidgetDefinitions] as WidgetDefinition[]);

const meta = { title: 'Widgets/KPI' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  width = 'w-64',
) {
  return (
    <div className={width}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('COLUMN_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="flex flex-wrap items-start gap-4 bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

// ── kpi-stat-card + usage-meter (M4 slice) ─────────────────────────────────

export const StatCardCurrency = {
  render: () =>
    host(
      'kpi-stat-card',
      'story-kpi-1',
      { title: 'Revenue', metricLabel: 'Revenue (30d)', metricFormat: 'currency', iconName: 'dollar' },
      { value: 48_210, prior: 42_900, spark: kpiStatCardDemoData(3).spark },
    ),
};

export const StatCardDownIsGood = {
  render: () =>
    host(
      'kpi-stat-card',
      'story-kpi-2',
      {
        title: 'Error rate',
        metricFormat: 'percent',
        invertDeltaGood: true,
        iconName: 'zap',
        iconTone: 'danger',
        showSparkline: false,
      },
      { value: 0.031, prior: 0.045 },
    ),
};

export const StatCardAbsoluteDelta = {
  render: () =>
    host(
      'kpi-stat-card',
      'story-kpi-3',
      { title: 'Team members', deltaMode: 'abs', iconName: 'users', iconTone: 'pos' },
      { value: 248, prior: 236 },
    ),
};

export const StatCardStates = {
  render: () => (
    <div className="flex gap-4">
      {host('kpi-stat-card', 'story-kpi-skeleton', { title: 'Loading' }, undefined, 'loading')}
      {host('kpi-stat-card', 'story-kpi-error', { title: 'Broken' }, undefined, 'error')}
      {host('kpi-stat-card', 'story-kpi-demo', { title: 'Demo seed' }, kpiStatCardDemoData(9))}
    </div>
  ),
};

export const UsageMeterTones = {
  render: () => (
    <div className="flex flex-col gap-4">
      {host('usage-meter', 'story-meter-ok', { title: 'AI credits', limit: 100 }, usageMeterDemoData(2))}
      {host('usage-meter', 'story-meter-warn', { title: 'Storage', limit: 100, unit: 'GB' }, { value: 85 })}
      {host(
        'usage-meter',
        'story-meter-danger',
        { title: 'API quota', limit: 100, ctaLabel: 'Free up space', ctaHref: '/settings/storage' },
        { value: 97 },
      )}
    </div>
  ),
};

// ── M7 Wave 4: the §1 tail ─────────────────────────────────────────────────

/** kpi-stat-tile-compact: the dense "power" row of 6 the annex describes. */
export const StatTileCompactRow = {
  name: 'kpi-stat-tile-compact (power row)',
  render: () => (
    <Frame>
      <div className="grid w-[52rem] grid-cols-6 gap-2">
        {['Sessions', 'Signups', 'Revenue', 'Churn', 'p95', 'Errors'].map((label, index) =>
          host(
            'kpi-stat-tile-compact',
            `s-tile-${index}`,
            // The last three are down-is-good metrics — the chips invert.
            { metricLabel: label, columns: 6, invertDeltaGood: index >= 3 },
            kpiStatTileCompactDemoData(index + 1),
            'success',
            'w-full',
          ),
        )}
      </div>
    </Frame>
  ),
};

/** metric-hero: the count-up, delta pill, spark and goal track. */
export const MetricHeroStory = {
  name: 'metric-hero',
  render: () => (
    <Frame>
      {host(
        'metric-hero',
        's-hero',
        { title: 'MRR', metricLabel: 'Monthly recurring revenue', goalValue: 650_000, goalLabel: 'Goal' },
        metricHeroDemoData(7),
        'success',
        'w-[22rem]',
      )}
      {host(
        'metric-hero',
        's-hero-nogoal',
        { title: 'Active users', metricFormat: 'compact', countUp: false },
        { value: 128_400, prior: 96_200, spark: metricHeroDemoData(3).spark },
        'success',
        'w-[22rem]',
      )}
    </Frame>
  ),
};

/** stat-pair-card: a payload pair, and a derived pair (LTV = MRR × 24). */
export const StatPairStory = {
  name: 'stat-pair-card',
  render: () => (
    <Frame>
      {host(
        'stat-pair-card',
        's-pair',
        { title: 'Revenue', metricALabel: 'MRR', metricBLabel: 'LTV' },
        statPairCardDemoData(4),
        'success',
        'w-[20rem]',
      )}
      {host(
        'stat-pair-card',
        's-pair-derived',
        {
          title: 'Derived',
          metricALabel: 'MRR',
          metricBLabel: 'LTV (24mo)',
          derivedFormula: 'multiply',
          derivedOperand: 24,
        },
        { value: 4_820 },
        'success',
        'w-[20rem]',
      )}
    </Frame>
  ),
};

/** gauge-ring: every band, centerFormat and footer variant. */
export const GaugeRingVariants = {
  name: 'gauge-ring (bands + footers)',
  render: () => (
    <Frame>
      {host('gauge-ring', 's-ring-pos', { title: 'Health score', centerFormat: 'fraction' }, { value: 86 })}
      {host('gauge-ring', 's-ring-warn', { title: 'Quota', centerFormat: 'percent' }, { value: 73 })}
      {host('gauge-ring', 's-ring-danger', { title: 'Uptime', centerFormat: 'value' }, { value: 38 })}
      {host(
        'gauge-ring',
        's-ring-spent',
        { title: 'Budget', footer: 'spent-of-total', metricFormat: 'currency', deltaMode: 'pct', max: 100 },
        { value: 62, total: 100, prior: 48 },
      )}
      {host(
        'gauge-ring',
        's-ring-avatars',
        { title: 'Assigned users', footer: 'avatar-stack', size: 'sm' },
        gaugeRingDemoData(5),
      )}
    </Frame>
  ),
};

/** gauge-arc: the single speedometer, the needle-less half arc, and the cluster. */
export const GaugeArcVariants = {
  name: 'gauge-arc (single + cluster)',
  render: () => (
    <Frame>
      {host('gauge-arc', 's-arc', { title: 'Performance' }, { value: 88 })}
      {host('gauge-arc', 's-arc-warn', { title: 'Latency', unit: 'ms', max: 500 }, { value: 310 })}
      {host('gauge-arc', 's-arc-plain', { title: 'Half arc', needle: false }, { value: 64 })}
      {host(
        'gauge-arc',
        's-arc-cluster',
        { title: 'Service SLAs', cluster: true, columns: 3 },
        gaugeArcDemoData(2),
        'success',
        'w-[30rem]',
      )}
    </Frame>
  ),
};

/** period-comparison: a rise, a decline, and a down-is-good decline. */
export const PeriodComparisonStory = {
  name: 'period-comparison',
  render: () => (
    <Frame>
      {host(
        'period-comparison',
        's-period-up',
        { title: 'Revenue', periodALabel: 'This month', periodBLabel: 'Last month' },
        periodComparisonDemoData(7),
      )}
      {host(
        'period-comparison',
        's-period-down',
        { title: 'Signups', periodALabel: 'This week', periodBLabel: 'Last week', metricFormat: 'plain' },
        { value: 210, prior: 340 },
      )}
      {host(
        'period-comparison',
        's-period-invert',
        { title: 'Cloud spend', periodALabel: 'This month', periodBLabel: 'Last month', invertDeltaGood: true },
        { value: 8_200, prior: 12_400 },
      )}
    </Frame>
  ),
};

/** micro-kpi-subtitle: the annex's header lines, plus the zero state. */
export const MicroKpiSubtitleStory = {
  name: 'micro-kpi-subtitle',
  render: () => (
    <Frame>
      <div className="flex flex-col gap-2">
        {host(
          'micro-kpi-subtitle',
          's-micro-1',
          { template: '{value} unread · {total} total' },
          microKpiSubtitleDemoData(3),
          'success',
          'w-auto',
        )}
        {host(
          'micro-kpi-subtitle',
          's-micro-2',
          { template: '{total} members · {online} online' },
          microKpiSubtitleDemoData(8),
          'success',
          'w-auto',
        )}
        {host(
          'micro-kpi-subtitle',
          's-micro-zero',
          { template: '{value} unread · {total} total', zeroStateText: 'All caught up' },
          { value: 0, total: 24 },
          'success',
          'w-auto',
        )}
      </div>
    </Frame>
  ),
};

/** auto-insights: the bullet rows and the tone-icon card grid. */
export const AutoInsightsVariants = {
  name: 'auto-insights (bullets + cards)',
  render: () => (
    <Frame>
      {host(
        'auto-insights',
        's-insights',
        { title: 'Auto-insights', count: 3, applyLabel: 'Apply' },
        autoInsightsDemoData(7),
        'success',
        'w-[26rem]',
      )}
      {host(
        'auto-insights',
        's-insights-cards',
        { title: 'AI smart insights', variant: 'cards', columns: 2, count: 4 },
        autoInsightsDemoData(2),
        'success',
        'w-[34rem]',
      )}
    </Frame>
  ),
};

// ── Four WidgetFrame states (acceptance #4) ────────────────────────────────

/** gauge-ring: loaded · skeleton · empty · error. */
export const GaugeRingStates = {
  render: () => (
    <Frame>
      {host('gauge-ring', 'gs-loaded', { title: 'Health score' }, gaugeRingDemoData(7))}
      {host('gauge-ring', 'gs-skeleton', { title: 'Health score' }, undefined, 'loading')}
      {host('gauge-ring', 'gs-empty', { title: 'Health score', emptyState: { titleKey: 'No score for range' } }, undefined)}
      {host('gauge-ring', 'gs-error', { title: 'Health score' }, undefined, 'error')}
    </Frame>
  ),
};

/** metric-hero: the same four states at hero scale. */
export const MetricHeroStates = {
  render: () => (
    <Frame>
      {host('metric-hero', 'hs-loaded', { title: 'MRR', goalValue: 650_000 }, metricHeroDemoData(7), 'success', 'w-[20rem]')}
      {host('metric-hero', 'hs-skeleton', { title: 'MRR' }, undefined, 'loading', 'w-[20rem]')}
      {host('metric-hero', 'hs-empty', { title: 'MRR', emptyState: { titleKey: 'No data for range' } }, undefined, 'success', 'w-[20rem]')}
      {host('metric-hero', 'hs-error', { title: 'MRR' }, undefined, 'error', 'w-[20rem]')}
    </Frame>
  ),
};

/** auto-insights: loaded · skeleton · the per-widget empty copy · error. */
export const AutoInsightsStates = {
  render: () => (
    <Frame>
      {host('auto-insights', 'is-loaded', { title: 'Insights', count: 2 }, autoInsightsDemoData(7), 'success', 'w-[24rem]')}
      {host('auto-insights', 'is-skeleton', { title: 'Insights' }, undefined, 'loading', 'w-[24rem]')}
      {host(
        'auto-insights',
        'is-empty',
        {
          title: 'Insights',
          emptyState: {
            titleKey: 'No insights yet',
            bodyKey: 'Insights appear once there is enough data to spot a pattern.',
          },
        },
        { rows: [], total: 0 },
        'success',
        'w-[24rem]',
      )}
      {host('auto-insights', 'is-error', { title: 'Insights' }, undefined, 'error', 'w-[24rem]')}
    </Frame>
  ),
};

// ── light/dark × LTR/RTL with real mirroring (acceptance #9) ───────────────

/**
 * The metric row. Under RTL the stat card's icon tile and delta pill swap ends,
 * the compact tile's label/value/spark row reverses, the stat pair's `border-s`
 * divider moves and its two metrics change sides — and the mono values stay latn
 * + `tabular-nums`, so the column still aligns in ar_EG.
 */
export const MetricThemeAndDirectionMatrix = {
  render: () => {
    const row = (key: string) => (
      <>
        {host(
          'kpi-stat-card',
          `${key}-card`,
          { title: 'Revenue', metricFormat: 'currency', iconName: 'dollar' },
          kpiStatCardDemoData(3),
          'success',
          'w-56',
        )}
        {host('kpi-stat-tile-compact', `${key}-tile`, { metricLabel: 'Sessions' }, kpiStatTileCompactDemoData(3), 'success', 'w-40')}
        {host(
          'metric-hero',
          `${key}-hero`,
          { title: 'MRR', goalValue: 650_000, goalLabel: 'Goal', countUp: false },
          metricHeroDemoData(7),
          'success',
          'w-72',
        )}
        {host(
          'stat-pair-card',
          `${key}-pair`,
          { title: 'Pair', metricALabel: 'MRR', metricBLabel: 'LTV' },
          statPairCardDemoData(4),
          'success',
          'w-64',
        )}
      </>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row('mm-l-ltr')}</Frame>
        <Frame dir="rtl">{row('mm-l-rtl')}</Frame>
        <Frame dark dir="ltr">{row('mm-d-ltr')}</Frame>
        <Frame dark dir="rtl">{row('mm-d-rtl')}</Frame>
      </div>
    );
  },
};

/**
 * The gauges — this matrix is the direction POLICY's regression capture. The
 * ring sweep and the arc's needle HOLD their rotation in RTL (rotational, not
 * directional — the donut rule), while everything around them mirrors: the
 * captions, the spent-of-total footer, the avatar stack's overlap direction, and
 * the cluster grid's cell order.
 */
export const GaugeThemeAndDirectionMatrix = {
  render: () => {
    const row = (key: string) => (
      <>
        {host('gauge-ring', `${key}-ring`, { title: 'Health', centerFormat: 'fraction' }, { value: 86 }, 'success', 'w-48')}
        {host(
          'gauge-ring',
          `${key}-ring-footer`,
          { title: 'Budget', footer: 'spent-of-total', metricFormat: 'currency', deltaMode: 'pct' },
          { value: 62, total: 100, prior: 48 },
          'success',
          'w-56',
        )}
        {host('gauge-arc', `${key}-arc`, { title: 'Performance' }, { value: 72 }, 'success', 'w-56')}
        {host('gauge-arc', `${key}-cluster`, { title: 'SLAs', cluster: true, columns: 3 }, gaugeArcDemoData(2), 'success', 'w-[26rem]')}
      </>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row('gm-l-ltr')}</Frame>
        <Frame dir="rtl">{row('gm-l-rtl')}</Frame>
        <Frame dark dir="ltr">{row('gm-d-ltr')}</Frame>
        <Frame dark dir="rtl">{row('gm-d-rtl')}</Frame>
      </div>
    );
  },
};

/**
 * The prose-bearing widgets. Under RTL the comparison's bar labels and diff
 * footer flow right-to-left (and the progress fills grow from the right), the
 * micro-KPI's `·`-separated clauses reorder, and the insight rows' icon tile,
 * tag chip and spark all swap ends.
 */
export const InsightThemeAndDirectionMatrix = {
  render: () => {
    const row = (key: string) => (
      <>
        {host(
          'period-comparison',
          `${key}-period`,
          { title: 'Revenue', periodALabel: 'This month', periodBLabel: 'Last month' },
          periodComparisonDemoData(7),
          'success',
          'w-64',
        )}
        {host(
          'micro-kpi-subtitle',
          `${key}-micro`,
          { template: '{value} unread · {total} total' },
          microKpiSubtitleDemoData(3),
          'success',
          'w-auto',
        )}
        {host(
          'auto-insights',
          `${key}-insights`,
          { title: 'Insights', count: 2, applyLabel: 'Apply' },
          autoInsightsDemoData(7),
          'success',
          'w-[24rem]',
        )}
      </>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row('im-l-ltr')}</Frame>
        <Frame dir="rtl">{row('im-l-rtl')}</Frame>
        <Frame dark dir="ltr">{row('im-d-ltr')}</Frame>
        <Frame dark dir="rtl">{row('im-d-rtl')}</Frame>
      </div>
    );
  },
};

// ── Interaction stories ────────────────────────────────────────────────────

/** auto-insights' Refresh rotation — `play` drives it so it stays a regression. */
export const AutoInsightsRefreshInteraction = {
  name: 'auto-insights (refresh rotation)',
  render: () => (
    <Frame>
      {host('auto-insights', 's-insights-play', { title: 'Insights', count: 2 }, autoInsightsDemoData(7), 'success', 'w-[26rem]')}
    </Frame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLElement>('[data-part="insights-refresh"]')?.click();
  },
};
