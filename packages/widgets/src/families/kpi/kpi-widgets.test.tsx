// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * KPI family (annex §1) render + unit tests, covering the complete 10-id slice:
 * the M4 pair (kpi-stat-card formatting, delta-pill trend + "down-is-good"
 * inversion, sparkline toggle; usage-meter threshold tones) and the M7 Wave-4
 * tail — the pure gauge geometry, the template interpolator, the derived-metric
 * arithmetic, the compact tile, the hero's count-up, the two SVG gauges'
 * band tinting, the comparison footer, and auto-insights' ranking + rotation.
 *
 * Locale is pinned via `config.format` overrides so number formatting is
 * assertable regardless of the runner's environment.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AutoInsights, autoInsightsConfigSchema, insightsOf, visibleWindow } from './AutoInsights.js';
import { GaugeArc, gaugeArcConfigSchema } from './GaugeArc.js';
import { GaugeRing, gaugeRingConfigSchema } from './GaugeRing.js';
import { KpiStatCard, kpiStatCardConfigSchema } from './KpiStatCard.js';
import { KpiStatTileCompact, kpiStatTileCompactConfigSchema } from './KpiStatTileCompact.js';
import { MetricHero, metricHeroConfigSchema } from './MetricHero.js';
import { MicroKpiSubtitle, microKpiSubtitleConfigSchema, scalarsOf } from './MicroKpiSubtitle.js';
import { PeriodComparison, periodComparisonConfigSchema } from './PeriodComparison.js';
import { StatPairCard, statPairCardConfigSchema, statPairValues } from './StatPairCard.js';
import { UsageMeter, usageMeterConfigSchema } from './UsageMeter.js';
import {
  DEFAULT_GAUGE_BANDS,
  applyDerived,
  arcPath,
  bandFor,
  clampValue,
  fractionOf,
  gaugeArcGeometry,
  gaugeRingGeometry,
  insightIconOf,
  interpolateTemplate,
  polarPoint,
  sharedToneOf,
  templateKeys,
  toneOf,
} from './kpi-lib.js';
import {
  autoInsightsDemoData,
  gaugeArcDemoData,
  gaugeRingDemoData,
  kpiStatCardDemoData,
  kpiStatTileCompactDemoData,
  kpiWidgetDefinitions,
  metricHeroDemoData,
  microKpiSubtitleDemoData,
  periodComparisonDemoData,
  statPairCardDemoData,
  usageMeterDemoData,
} from './definitions.js';
import { isEmptyData } from '../../registry/data-empty.js';

const noop = () => {};

/** Schema defaults + overrides — the same projection the host performs. */
function cfg<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse({ format: { locale: 'en-US' }, ...overrides });
}

function statCardConfig(input: Record<string, unknown>) {
  return kpiStatCardConfigSchema.parse({ format: { locale: 'en-US' }, ...input });
}

describe('kpi-stat-card', () => {
  it('formats the value per config.metricFormat and renders label + delta', () => {
    render(
      <KpiStatCard
        config={statCardConfig({ metricLabel: 'Revenue (30d)', metricFormat: 'currency' })}
        data={{ value: 48_210, prior: 42_900 }}
        instanceId="w1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('$48,210')).toBeDefined();
    expect(screen.getByText('Revenue (30d)')).toBeDefined();
    const pill = screen.getByText('+12.4%').closest('[data-trend]');
    expect(pill?.getAttribute('data-trend')).toBe('up');
    expect(pill?.getAttribute('data-tone')).toBe('pos');
  });

  it('inverts the delta tone for down-is-good metrics (invertDeltaGood)', () => {
    render(
      <KpiStatCard
        config={statCardConfig({ metricFormat: 'percent', invertDeltaGood: true })}
        data={{ value: 0.031, prior: 0.045 }}
        instanceId="w2"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('3.1%')).toBeDefined();
    const pill = document.querySelector('[data-trend]');
    expect(pill?.getAttribute('data-trend')).toBe('down');
    expect(pill?.getAttribute('data-tone')).toBe('pos'); // down reads as good
  });

  it('renders the spark bars only when configured and present, and hides the pill for deltaMode none', () => {
    const { container, rerender } = render(
      <KpiStatCard
        config={statCardConfig({ showSparkline: true })}
        data={{ value: 10, spark: [1, 2, 3, 4, 5, 6, 7, 8] }}
        instanceId="w3"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('.adm-spark')).not.toBeNull();
    expect(container.querySelector('[data-trend]')).toBeNull(); // no prior/deltaPct

    rerender(
      <KpiStatCard
        config={statCardConfig({ showSparkline: false, deltaMode: 'none' })}
        data={{ value: 10, prior: 5, spark: [1, 2, 3] }}
        instanceId="w3"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('.adm-spark')).toBeNull();
    expect(container.querySelector('[data-trend]')).toBeNull();
  });

  it('demo data is deterministic per seed and matches the metric+delta contract', () => {
    expect(kpiStatCardDemoData(7)).toEqual(kpiStatCardDemoData(7));
    const demo = kpiStatCardDemoData(7);
    expect(demo.value).toBeGreaterThan(0);
    expect(demo.spark).toHaveLength(8);
    expect(usageMeterDemoData(3)).toEqual(usageMeterDemoData(3));
  });
});

describe('usage-meter', () => {
  function meter(value: number, config: Record<string, unknown> = {}) {
    const { container } = render(
      <UsageMeter
        config={usageMeterConfigSchema.parse({ title: 'AI credits', limit: 100, ...config })}
        data={{ value }}
        instanceId="m1"
        onEvent={noop}
      />,
    );
    return container.querySelector('[data-widget="usage-meter"]');
  }

  it('stays accent under the warn threshold', () => {
    expect(meter(50)?.getAttribute('data-tone')).toBe('accent');
  });

  it('flips to warn at 80% and danger at 95%', () => {
    expect(meter(85)?.getAttribute('data-tone')).toBe('warn');
    expect(meter(96, { title: 'Storage' })?.getAttribute('data-tone')).toBe('danger');
  });

  it('renders the "used of limit" mono text and an accessible progressbar', () => {
    meter(72, { unit: 'GB' });
    expect(screen.getByText(/72/)).toBeDefined();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('72');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });
});

describe('kpi definitions', () => {
  it('registers the complete annex §1 slice (10 ids)', () => {
    // M7 Wave 4 closed the family out; ANNEX_PENDING.kpi is now [] and the
    // parity gate asserts this list against the checked-in annex extraction.
    expect(kpiWidgetDefinitions.map((d) => d.id)).toEqual([
      'kpi-stat-card',
      'usage-meter',
      'kpi-stat-tile-compact',
      'metric-hero',
      'stat-pair-card',
      'gauge-ring',
      'gauge-arc',
      'period-comparison',
      'micro-kpi-subtitle',
      'auto-insights',
    ]);
  });

  it('carries the annex grid sizing in 40px half-units (04 §6.1)', () => {
    const sizingOf = (id: string) => kpiWidgetDefinitions.find((d) => d.id === id)?.sizing;
    // h = round(annexRows × 2); widths map 1:1.
    expect(sizingOf('kpi-stat-card')).toEqual({ minW: 3, minH: 2, defaultW: 3, defaultH: 3 }); // 3×1.5
    expect(sizingOf('kpi-stat-tile-compact')).toEqual({ minW: 2, minH: 2, defaultW: 2, defaultH: 2 }); // 2×1
    expect(sizingOf('metric-hero')).toEqual({ minW: 4, minH: 4, defaultW: 4, defaultH: 4 }); // 4×2
    expect(sizingOf('gauge-ring')).toEqual({ minW: 3, minH: 4, defaultW: 3, defaultH: 4 }); // 3×2
    expect(sizingOf('gauge-arc')).toEqual({ minW: 3, minH: 4, defaultW: 6, defaultH: 4 }); // single 3×2, cluster 6×2
    expect(sizingOf('period-comparison')).toEqual({ minW: 3, minH: 2, defaultW: 3, defaultH: 3 }); // 3×1.5
    expect(sizingOf('auto-insights')).toEqual({ minW: 4, minH: 4, defaultW: 6, defaultH: 4 }); // 4×2 → 6×2
  });

  it('declares each widget’s §3 data contract and placement', () => {
    const byId = new Map(kpiWidgetDefinitions.map((d) => [d.id, d]));
    expect(byId.get('kpi-stat-card')?.dataContract).toBe('metric+delta');
    expect(byId.get('kpi-stat-card')?.placement).toBe('grid');
    // The annex's "two single-metric values for adjacent windows" IS metric+delta.
    expect(byId.get('period-comparison')?.dataContract).toBe('metric+delta');
    // `cluster` is config, so the gauge accepts the score AND the cluster list.
    expect(byId.get('gauge-arc')?.dataContract).toEqual(['single-metric', 'categorical']);
    expect(byId.get('auto-insights')?.dataContract).toBe('record-list');
    // annex: "inline (page header slot)" — never grid-placed.
    expect(byId.get('micro-kpi-subtitle')?.placement).toBe('inline');
  });

  it('every definition names an i18n descriptionKey under widgets.kpi.*', () => {
    for (const definition of kpiWidgetDefinitions) {
      expect(definition.descriptionKey).toMatch(/^widgets\.kpi\.[a-zA-Z]+\.description$/);
    }
  });

  it('every demoData payload is deterministic per seed (04 §7.7)', () => {
    const generators = [
      kpiStatCardDemoData,
      usageMeterDemoData,
      kpiStatTileCompactDemoData,
      metricHeroDemoData,
      statPairCardDemoData,
      gaugeRingDemoData,
      gaugeArcDemoData,
      periodComparisonDemoData,
      microKpiSubtitleDemoData,
      autoInsightsDemoData,
    ];
    for (const generate of generators) {
      expect(generate(7)).toEqual(generate(7));
      // Distinct seeds must differ — proves the seed threads through.
      expect(generate(7)).not.toEqual(generate(8));
    }
  });
});

// ── kpi-lib: gauge geometry ────────────────────────────────────────────────

describe('kpi-lib — value clamping', () => {
  it('clamps into [0, max] and reads a non-finite value as 0', () => {
    expect(clampValue(150, 100)).toBe(100);
    expect(clampValue(-4, 100)).toBe(0);
    expect(clampValue(Number.NaN, 100)).toBe(0);
    expect(clampValue(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });

  it('falls back to a 100 scale when max is non-positive (never divides by zero)', () => {
    expect(fractionOf(50, 0)).toBe(0.5);
    expect(fractionOf(50, -10)).toBe(0.5);
  });
});

describe('kpi-lib — bandFor', () => {
  it('returns the first band at or above the value, in ascending cutoff order', () => {
    expect(bandFor(30, DEFAULT_GAUGE_BANDS)?.tone).toBe('danger');
    expect(bandFor(60, DEFAULT_GAUGE_BANDS)?.tone).toBe('warn');
    expect(bandFor(90, DEFAULT_GAUGE_BANDS)?.tone).toBe('pos');
  });

  it('treats the cutoff as INCLUSIVE (50 is still Critical, 51 is Degraded)', () => {
    expect(bandFor(50, DEFAULT_GAUGE_BANDS)?.label).toBe('Critical');
    expect(bandFor(51, DEFAULT_GAUGE_BANDS)?.label).toBe('Degraded');
  });

  it('sorts unordered bands rather than trusting config order', () => {
    const scrambled = [
      { to: 100, tone: 'pos' as const },
      { to: 50, tone: 'danger' as const },
      { to: 75, tone: 'warn' as const },
    ];
    expect(bandFor(30, scrambled)?.tone).toBe('danger');
    expect(bandFor(60, scrambled)?.tone).toBe('warn');
  });

  it('a value above every cutoff takes the highest band; an empty list is null', () => {
    expect(bandFor(999, DEFAULT_GAUGE_BANDS)?.tone).toBe('pos');
    expect(bandFor(50, [])).toBeNull();
  });
});

describe('kpi-lib — gaugeRingGeometry', () => {
  it('derives the dashoffset from the fraction (full sweep at max, empty at 0)', () => {
    const full = gaugeRingGeometry(100, 100);
    expect(full.fraction).toBe(1);
    expect(full.dashOffset).toBeCloseTo(0, 6);

    const empty = gaugeRingGeometry(0, 100);
    expect(empty.dashOffset).toBeCloseTo(empty.circumference, 6);

    const half = gaugeRingGeometry(50, 100);
    expect(half.dashOffset).toBeCloseTo(half.circumference / 2, 6);
  });

  it('insets the radius by half the stroke so the ring never clips the viewBox', () => {
    const geometry = gaugeRingGeometry(50, 100, 'lg');
    expect(geometry.radius + geometry.thickness / 2).toBeLessThanOrEqual(geometry.size / 2);
  });
});

describe('kpi-lib — arc geometry', () => {
  it('maps the 180→360 sweep onto left → top → right in SVG space (y grows down)', () => {
    const left = polarPoint(100, 100, 50, 180);
    expect(left.x).toBeCloseTo(50, 6);
    expect(left.y).toBeCloseTo(100, 6);

    const top = polarPoint(100, 100, 50, 270);
    expect(top.x).toBeCloseTo(100, 6);
    expect(top.y).toBeCloseTo(50, 6);

    const right = polarPoint(100, 100, 50, 360);
    expect(right.x).toBeCloseTo(150, 6);
    expect(right.y).toBeCloseTo(100, 6);
  });

  it('emits a deterministic 3-dp path (byte-identical in Node and the browser)', () => {
    expect(arcPath(100, 100, 50, 180, 360)).toBe(arcPath(100, 100, 50, 180, 360));
    expect(arcPath(100, 100, 50, 180, 360)).toMatch(/^M 50 100 A 50 50 0 [01] 1 150 100$/);
  });

  it('returns an empty path for a zero-length sweep or a non-positive radius', () => {
    expect(arcPath(100, 100, 50, 180, 180)).toBe('');
    expect(arcPath(100, 100, 0, 180, 360)).toBe('');
  });

  it('places the needle at the arc start for 0 and the arc end for max', () => {
    const zero = gaugeArcGeometry(0, 100, DEFAULT_GAUGE_BANDS);
    expect(zero.needle.x).toBeLessThan(zero.cx);
    expect(zero.valuePath).toBe(''); // nothing swept yet

    const full = gaugeArcGeometry(100, 100, DEFAULT_GAUGE_BANDS);
    expect(full.needle.x).toBeGreaterThan(full.cx);
    expect(full.fraction).toBe(1);
  });

  it('builds one contiguous segment per band, in ascending cutoff order', () => {
    const geometry = gaugeArcGeometry(60, 100, DEFAULT_GAUGE_BANDS);
    expect(geometry.bandSegments.map((s) => s.tone)).toEqual(['danger', 'warn', 'pos']);
    for (const segment of geometry.bandSegments) expect(segment.path).not.toBe('');
  });

  it('drops a band whose cutoff is already covered (never draws a zero-length segment)', () => {
    const overlapping = [
      { to: 50, tone: 'danger' as const },
      { to: 50, tone: 'warn' as const }, // same cutoff — nothing left to draw
      { to: 100, tone: 'pos' as const },
    ];
    expect(gaugeArcGeometry(60, 100, overlapping).bandSegments.map((s) => s.tone)).toEqual([
      'danger',
      'pos',
    ]);
  });
});

// ── kpi-lib: template + derived + tone narrowing ───────────────────────────

describe('kpi-lib — interpolateTemplate', () => {
  const scalars = { value: 3, total: 10, name: 'Inbox' };

  it('substitutes numeric scalars through the Intl metric formatter', () => {
    expect(interpolateTemplate('{value} unread · {total} total', scalars, 'plain', { locale: 'en-US' })).toBe(
      '3 unread · 10 total',
    );
  });

  it('passes string scalars through verbatim', () => {
    expect(interpolateTemplate('{name}: {value}', scalars, 'plain', { locale: 'en-US' })).toBe('Inbox: 3');
  });

  it('resolves an UNKNOWN placeholder to empty rather than leaking template syntax', () => {
    // A stored template that outlives its binding must degrade to a shorter
    // sentence, never render a raw `{token}` to the user.
    expect(interpolateTemplate('{missing} unread', scalars, 'plain', { locale: 'en-US' })).toBe(' unread');
  });

  it('reads each token separately rather than greedily spanning them', () => {
    expect(templateKeys('{value} of {total} · {value}')).toEqual(['value', 'total']);
    expect(templateKeys('no tokens here')).toEqual([]);
  });
});

describe('kpi-lib — applyDerived', () => {
  it('applies each arithmetic op', () => {
    expect(applyDerived(10, 'add', 5)).toBe(15);
    expect(applyDerived(10, 'subtract', 5)).toBe(5);
    expect(applyDerived(10, 'multiply', 5)).toBe(50);
    expect(applyDerived(10, 'divide', 5)).toBe(2);
  });

  it('returns null for `none` (side B comes off the payload instead)', () => {
    expect(applyDerived(10, 'none', 5)).toBeNull();
  });

  it('returns null for a divide-by-zero rather than rendering "Infinity"', () => {
    expect(applyDerived(10, 'divide', 0)).toBeNull();
  });
});

describe('kpi-lib — tone narrowing', () => {
  it('narrows a raw tone column to the vocabulary, else the fallback', () => {
    expect(toneOf('warn')).toBe('warn');
    expect(toneOf('chartreuse')).toBe('accent');
    expect(toneOf(undefined, 'info')).toBe('info');
  });

  it('narrows an unknown insight icon to sparkles', () => {
    expect(insightIconOf('trend-up')).toBe('trend-up');
    expect(insightIconOf('rocket')).toBe('sparkles');
    expect(insightIconOf(undefined)).toBe('sparkles');
  });

  it('maps the shared config tone `muted` onto the component vocabulary’s `neutral`', () => {
    // The two enums differ deliberately — see sharedToneOf's note.
    expect(sharedToneOf('muted', 'accent')).toBe('neutral');
    expect(sharedToneOf('warn', 'accent')).toBe('warn');
    expect(sharedToneOf(undefined, 'accent')).toBe('accent');
  });
});

// ── kpi-stat-tile-compact ──────────────────────────────────────────────────

describe('kpi-stat-tile-compact', () => {
  it('renders the micro-label, mono value, delta chip and the 6-bar spark', () => {
    const { container } = render(
      <KpiStatTileCompact
        config={cfg(kpiStatTileCompactConfigSchema, { metricLabel: 'Sessions', metricFormat: 'compact' })}
        data={{ value: 12_400, prior: 9_800, spark: [1, 2, 3, 4, 5, 6] }}
        instanceId="t1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('12.4K')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(container.querySelector('[data-trend]')?.getAttribute('data-trend')).toBe('up');
    expect(container.querySelector('.adm-spark')).not.toBeNull();
  });

  it('carries the configured column density for the generator’s row packing', () => {
    const { container } = render(
      <KpiStatTileCompact
        config={cfg(kpiStatTileCompactConfigSchema, { columns: 4 })}
        data={{ value: 10 }}
        instanceId="t2"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('[data-widget]')?.getAttribute('data-columns')).toBe('4');
  });

  it('hides the spark when showSparkline is off', () => {
    const { container } = render(
      <KpiStatTileCompact
        config={cfg(kpiStatTileCompactConfigSchema, { showSparkline: false })}
        data={{ value: 10, spark: [1, 2, 3] }}
        instanceId="t3"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('.adm-spark')).toBeNull();
  });
});

// ── metric-hero ────────────────────────────────────────────────────────────

describe('metric-hero', () => {
  it('renders the final value immediately when countUp is off', () => {
    render(
      <MetricHero
        config={cfg(metricHeroConfigSchema, { countUp: false, metricFormat: 'currency' })}
        data={{ value: 480_000, prior: 360_000 }}
        instanceId="h1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('$480.0K')).toBeDefined();
  });

  it('renders the goal track with the computed percentage', () => {
    const { container } = render(
      <MetricHero
        config={cfg(metricHeroConfigSchema, { countUp: false, goalValue: 650_000, goalLabel: 'Goal' })}
        data={{ value: 481_000 }}
        instanceId="h2"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('[data-part="goal-track"]')).not.toBeNull();
    // 481k/650k = 74%
    expect(screen.getByText(/Goal · \$650.0K, 74%/)).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('74');
  });

  it('config.goalValue overrides the payload’s goal scalar', () => {
    render(
      <MetricHero
        config={cfg(metricHeroConfigSchema, { countUp: false, goalValue: 200, metricFormat: 'plain' })}
        data={{ value: 100, goal: 999 }}
        instanceId="h3"
        onEvent={noop}
      />,
    );
    expect(screen.getByText(/Goal · 200, 50%/)).toBeDefined();
  });

  it('omits the goal track entirely when neither config nor payload carries a goal', () => {
    const { container } = render(
      <MetricHero
        config={cfg(metricHeroConfigSchema, { countUp: false })}
        data={{ value: 100 }}
        instanceId="h4"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('[data-part="goal-track"]')).toBeNull();
  });

  it('caps the spark strip at the configured bar count', () => {
    const { container } = render(
      <MetricHero
        config={cfg(metricHeroConfigSchema, { countUp: false, sparkBars: 4 })}
        data={{ value: 100, spark: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }}
        instanceId="h5"
        onEvent={noop}
      />,
    );
    expect(container.querySelectorAll('.adm-spark rect').length).toBeLessThanOrEqual(4);
  });

  it('renders the final value on the FIRST frame under prefers-reduced-motion', () => {
    // The count-up is exactly the motion the query exists to suppress; the hook
    // must SEED its state from it rather than transition to it, so no
    // intermediate value ever paints. rAF is stubbed to never fire, which would
    // strand an animated hero at 0.
    const matchMedia = vi.fn().mockReturnValue({ matches: true, media: '', addEventListener: noop, removeEventListener: noop });
    vi.stubGlobal('matchMedia', matchMedia);
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      render(
        <MetricHero
          config={cfg(metricHeroConfigSchema, { countUp: true, metricFormat: 'plain' })}
          data={{ value: 4200 }}
          instanceId="h6"
          onEvent={noop}
        />,
      );
      expect(screen.getByText('4,200')).toBeDefined();
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

// ── stat-pair-card ─────────────────────────────────────────────────────────

describe('stat-pair-card', () => {
  it('renders both payload sides with their own per-side format', () => {
    render(
      <StatPairCard
        config={cfg(statPairCardConfigSchema, {
          metricALabel: 'MRR',
          metricBLabel: 'Customers',
          metricAFormat: 'currency',
          metricBFormat: 'plain',
        })}
        data={{ value: 48_000, valueB: 1_204 }}
        instanceId="p1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('$48,000')).toBeDefined();
    expect(screen.getByText('1,204')).toBeDefined();
    expect(screen.getByText('MRR')).toBeDefined();
  });

  it('derives side B from side A when a formula is configured (LTV = MRR × 24)', () => {
    const values = statPairValues(
      { value: 1_000, valueB: 999_999 }, // payload B is ignored under a formula
      { valueAField: 'value', valueBField: 'valueB', derivedFormula: 'multiply', derivedOperand: 24 },
    );
    expect(values).toEqual({ a: 1_000, b: 24_000 });
  });

  it('reads side B off the payload when derivedFormula is none', () => {
    expect(
      statPairValues(
        { value: 10, valueB: 20 },
        { valueAField: 'value', valueBField: 'valueB', derivedFormula: 'none', derivedOperand: 1 },
      ),
    ).toEqual({ a: 10, b: 20 });
  });

  it('honours the configured field names (04 §5)', () => {
    expect(
      statPairValues(
        { mrr: 500, ltv: 12_000 },
        { valueAField: 'mrr', valueBField: 'ltv', derivedFormula: 'none', derivedOperand: 1 },
      ),
    ).toEqual({ a: 500, b: 12_000 });
  });

  it('renders an em-dash for an unbound side rather than NaN', () => {
    render(
      <StatPairCard
        config={cfg(statPairCardConfigSchema, { metricAFormat: 'plain' })}
        data={{ value: 7 }}
        instanceId="p2"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('—')).toBeDefined();
  });

  it('divides by zero to an em-dash, never "Infinity"', () => {
    render(
      <StatPairCard
        config={cfg(statPairCardConfigSchema, { derivedFormula: 'divide', derivedOperand: 0 })}
        data={{ value: 10 }}
        instanceId="p3"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('—')).toBeDefined();
  });
});

// ── gauge-ring ─────────────────────────────────────────────────────────────

describe('gauge-ring', () => {
  function ring(value: number, overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
    const { container } = render(
      <GaugeRing
        config={cfg(gaugeRingConfigSchema, overrides)}
        data={{ value, ...data }}
        instanceId="g1"
        onEvent={noop}
      />,
    );
    return container;
  }

  it('tints by the band the value falls in', () => {
    expect(ring(30).querySelector('[data-widget]')?.getAttribute('data-tone')).toBe('danger');
    expect(ring(60).querySelector('[data-widget]')?.getAttribute('data-tone')).toBe('warn');
    expect(ring(90).querySelector('[data-widget]')?.getAttribute('data-tone')).toBe('pos');
  });

  it('renders the band label as the status caption', () => {
    ring(90);
    expect(screen.getByText('Healthy')).toBeDefined();
  });

  it('config.caption overrides the band label', () => {
    ring(90, { caption: '5M rows' });
    expect(screen.getByText('5M rows')).toBeDefined();
  });

  it('renders each centerFormat variant', () => {
    expect(ring(86, { centerFormat: 'percent' }).textContent).toContain('86%');
    expect(ring(86, { centerFormat: 'value' }).textContent).toContain('86');
    expect(ring(86, { centerFormat: 'fraction' }).textContent).toContain('86/100');
  });

  it('renders the spent-of-total footer with the delta pill', () => {
    const container = ring(
      60,
      { footer: 'spent-of-total', metricFormat: 'currency', deltaMode: 'pct', max: 100 },
      { prior: 40 },
    );
    expect(container.querySelector('[data-part="gauge-footer"]')).not.toBeNull();
    expect(container.querySelector('[data-trend]')?.getAttribute('data-trend')).toBe('up');
  });

  it('renders the avatar-stack footer from the payload', () => {
    const container = ring(60, { footer: 'avatar-stack' }, { avatars: ['Ada Lovelace', 'Grace Hopper'] });
    expect(container.querySelector('[data-part="gauge-footer"]')).not.toBeNull();
    expect(screen.getByText('AL')).toBeDefined();
  });

  it('renders no footer by default', () => {
    expect(ring(60).querySelector('[data-part="gauge-footer"]')).toBeNull();
  });

  it('gives the SVG an accessible name carrying the caption and value', () => {
    ring(90, { centerFormat: 'percent' });
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Healthy: 90%');
  });

  it('clamps an over-max value to a full sweep rather than overshooting the ring', () => {
    // Assert the SETTLED frame: the sweep animates from empty, so an
    // unsettled render legitimately shows the full circumference offset.
    // prefers-reduced-motion makes useMountAnimation paint the final frame
    // on mount, which is the frame this invariant is about.
    const matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true, media: '', addEventListener: noop, removeEventListener: noop });
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      const container = ring(150, { max: 100 });
      const value = container.querySelector('[data-part="gauge-value"]');
      expect(Number(value?.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('starts the sweep empty and settles to the value (mount animation, 04 §7.5)', () => {
    // Without reduced motion the first frame is the "from" state — that is what
    // makes the CSS transition run at all.
    const container = ring(100, { max: 100 });
    const value = container.querySelector('[data-part="gauge-value"]');
    const dash = Number(value?.getAttribute('stroke-dasharray'));
    expect(Number(value?.getAttribute('stroke-dashoffset'))).toBeCloseTo(dash, 3);
  });
});

// ── gauge-arc ──────────────────────────────────────────────────────────────

describe('gauge-arc', () => {
  it('renders the single speedometer with a needle and the band caption', () => {
    const { container } = render(
      <GaugeArc
        config={cfg(gaugeArcConfigSchema)}
        data={{ value: 88 }}
        instanceId="a1"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('[data-widget]')?.getAttribute('data-cluster')).toBe('false');
    expect(container.querySelector('[data-part="gauge-needle"]')).not.toBeNull();
    expect(screen.getByText('Healthy')).toBeDefined();
  });

  it('drops the needle for the plain half-arc dasharray variant', () => {
    const { container } = render(
      <GaugeArc
        config={cfg(gaugeArcConfigSchema, { needle: false })}
        data={{ value: 88 }}
        instanceId="a2"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('[data-part="gauge-needle"]')).toBeNull();
  });

  it('renders one cell per category in cluster mode, honouring each row’s tone', () => {
    const { container } = render(
      <GaugeArc
        config={cfg(gaugeArcConfigSchema, { cluster: true, columns: 3 })}
        data={{
          items: [
            { key: 'a', label: 'API gateway', value: 92, tone: 'pos' },
            { key: 'b', label: 'Job runner', value: 44, tone: 'danger' },
          ],
        }}
        instanceId="a3"
        onEvent={noop}
      />,
    );
    const cells = container.querySelectorAll('[data-part="gauge-cell"]');
    expect(cells).toHaveLength(2);
    expect(cells[0]?.getAttribute('data-tone')).toBe('pos');
    expect(cells[1]?.getAttribute('data-tone')).toBe('danger');
    expect(screen.getByText('API gateway')).toBeDefined();
  });

  /**
   * The arc and the text must agree. The cell resolves the item's declared tone
   * (`toneOf`), and the SWEEP has to use that same resolved tone — deriving it
   * from `bandFor(value, bands)` instead makes a `danger`-toned service render a
   * red label over a green arc, i.e. a gauge contradicting its own reading.
   */
  it('paints the sweep in the cell’s resolved tone, not a re-derived band tone', () => {
    const { container } = render(
      <GaugeArc
        config={cfg(gaugeArcConfigSchema, { cluster: true })}
        // 90 lands in the DEFAULT `pos` band, but the row declares `danger`.
        data={{ items: [{ key: 'a', label: 'API', value: 90, tone: 'danger' }] }}
        instanceId="a3b"
        onEvent={noop}
      />,
    );
    const cell = container.querySelector('[data-part="gauge-cell"]');
    expect(cell?.getAttribute('data-tone')).toBe('danger');
    expect(cell?.querySelector('[data-part="gauge-value"]')?.getAttribute('class')).toContain('stroke-danger');
  });

  /**
   * The frame cannot route this one: `gauge-arc` declares
   * `['single-metric', 'categorical']`, and `isEmptyData` reads a multi-shape
   * contract as empty only when EVERY shape does — `single-metric` never is. So
   * a cluster bound to a query that legitimately returns zero rows arrives in
   * the `loaded` state, and the widget owns the per-widget empty copy (04 §4)
   * rather than showing developer error prose.
   */
  it('renders its own empty copy for a cluster with no rows — never "Unexpected data shape"', () => {
    const { container } = render(
      <GaugeArc
        config={cfg(gaugeArcConfigSchema, { cluster: true, emptyTitle: 'No services' })}
        data={{ items: [] }}
        instanceId="a3c"
        onEvent={noop}
      />,
    );
    expect(isEmptyData({ items: [] }, ['single-metric', 'categorical'])).toBe(false); // the frame stays `loaded`
    expect(screen.getByText('No services')).toBeDefined();
    expect(container.textContent).not.toContain('Unexpected data shape');
  });

  it('still calls a genuinely malformed cluster payload an unexpected shape', () => {
    const { container } = render(
      <GaugeArc
        config={cfg(gaugeArcConfigSchema, { cluster: true })}
        data={{ nope: true }}
        instanceId="a3d"
        onEvent={noop}
      />,
    );
    expect(container.textContent).toContain('Unexpected data shape');
  });

  it('falls back to the band tone when a cluster row carries no tone', () => {
    const { container } = render(
      <GaugeArc
        config={cfg(gaugeArcConfigSchema, { cluster: true })}
        data={{ items: [{ key: 'a', label: 'Search', value: 30 }] }}
        instanceId="a4"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('[data-part="gauge-cell"]')?.getAttribute('data-tone')).toBe('danger');
  });

  it('appends the configured unit to the reading', () => {
    render(
      <GaugeArc
        config={cfg(gaugeArcConfigSchema, { unit: 'ms', max: 500, valueFormat: 'plain' })}
        data={{ value: 180 }}
        instanceId="a5"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('180ms')).toBeDefined();
  });

  it('reads the same demo payload through either accepted shape (04 §3)', () => {
    // `cluster` is config, so demoData carries BOTH `value` and `items`.
    const demo = gaugeArcDemoData(3);
    expect(typeof demo.value).toBe('number');
    expect(demo.items.length).toBeGreaterThan(0);
  });
});

// ── period-comparison ──────────────────────────────────────────────────────

describe('period-comparison', () => {
  function comparison(data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    const { container } = render(
      <PeriodComparison
        config={cfg(periodComparisonConfigSchema, overrides)}
        data={data}
        instanceId="c1"
        onEvent={noop}
      />,
    );
    return container;
  }

  it('renders both period bars and the computed diff footer', () => {
    const container = comparison(
      { value: 48_200, prior: 35_100 },
      { periodALabel: 'This month', periodBLabel: 'Last month', metricFormat: 'currency' },
    );
    expect(screen.getByText('This month')).toBeDefined();
    expect(screen.getByText('Last month')).toBeDefined();
    const footer = container.querySelector('[data-part="diff-footer"]');
    expect(footer?.textContent).toContain('+$13,100');
    expect(footer?.textContent).toContain('37.3%');
    expect(footer?.textContent).toContain('higher');
  });

  it('scales both bars against the LARGER value so the comparison reads visually', () => {
    const container = comparison({ value: 100, prior: 50 }, { metricFormat: 'plain' });
    const bars = container.querySelectorAll('[role="progressbar"]');
    expect(bars[0]?.getAttribute('aria-valuenow')).toBe('100');
    expect(bars[0]?.getAttribute('aria-valuemax')).toBe('100');
    expect(bars[1]?.getAttribute('aria-valuenow')).toBe('50');
    expect(bars[1]?.getAttribute('aria-valuemax')).toBe('100'); // same scale, not its own
  });

  it('reads a decline as "lower" and tones the footer danger', () => {
    const container = comparison({ value: 20, prior: 50 }, { metricFormat: 'plain' });
    expect(container.querySelector('[data-widget]')?.getAttribute('data-trend')).toBe('down');
    const footer = container.querySelector('[data-part="diff-footer"]');
    expect(footer?.textContent).toContain('lower');
    expect(footer?.className).toContain('text-danger');
  });

  it('invertDeltaGood tones a decline as GOOD (costs, error rates, churn)', () => {
    const container = comparison({ value: 20, prior: 50 }, { metricFormat: 'plain', invertDeltaGood: true });
    const footer = container.querySelector('[data-part="diff-footer"]');
    expect(footer?.className).toContain('text-pos');
    expect(footer?.textContent).toContain('lower'); // direction is still down
  });

  it('uses the configured direction labels', () => {
    const container = comparison(
      { value: 50, prior: 20 },
      { metricFormat: 'plain', higherLabel: 'над планом' },
    );
    expect(container.querySelector('[data-part="diff-footer"]')?.textContent).toContain('над планом');
  });
});

// ── micro-kpi-subtitle ─────────────────────────────────────────────────────

describe('micro-kpi-subtitle', () => {
  it('renders the interpolated template from the bound scalars', () => {
    const { container } = render(
      <MicroKpiSubtitle
        config={cfg(microKpiSubtitleConfigSchema, { template: '{value} unread · {total} total' })}
        data={{ value: 3, total: 10 }}
        instanceId="m1"
        onEvent={noop}
      />,
    );
    expect(container.textContent).toBe('3 unread · 10 total');
  });

  it('swaps to zeroStateText when the zeroKey scalar is 0', () => {
    const { container } = render(
      <MicroKpiSubtitle
        config={cfg(microKpiSubtitleConfigSchema, {
          template: '{value} unread',
          zeroStateText: 'All caught up',
        })}
        data={{ value: 0, total: 10 }}
        instanceId="m2"
        onEvent={noop}
      />,
    );
    expect(container.textContent).toBe('All caught up');
    expect(container.querySelector('[data-widget]')?.getAttribute('data-zero')).toBe('true');
  });

  it('keeps the template when a NON-zeroKey scalar is 0', () => {
    const { container } = render(
      <MicroKpiSubtitle
        config={cfg(microKpiSubtitleConfigSchema, {
          template: '{value} of {total}',
          zeroKey: 'value',
          zeroStateText: 'All caught up',
        })}
        data={{ value: 4, total: 0 }}
        instanceId="m3"
        onEvent={noop}
      />,
    );
    expect(container.textContent).toBe('4 of 0');
  });

  it('falls back to the template when no zeroStateText is configured', () => {
    const { container } = render(
      <MicroKpiSubtitle
        config={cfg(microKpiSubtitleConfigSchema, { template: '{value} unread' })}
        data={{ value: 0 }}
        instanceId="m4"
        onEvent={noop}
      />,
    );
    expect(container.textContent).toBe('0 unread');
  });

  it('flattens only number/string scalars off the payload', () => {
    expect(scalarsOf({ value: 3, name: 'Inbox', rows: [1, 2], nested: { a: 1 }, nil: null })).toEqual({
      value: 3,
      name: 'Inbox',
    });
    expect(scalarsOf(null)).toEqual({});
    expect(scalarsOf([1, 2])).toEqual({});
  });
});

// ── auto-insights ──────────────────────────────────────────────────────────

describe('auto-insights — projection + ranking', () => {
  const config = autoInsightsConfigSchema.parse({});

  it('ranks by score DESCENDING (the annex’s "ranked list")', () => {
    const insights = insightsOf(
      {
        rows: [
          { id: 'a', title: 'Low', score: 10 },
          { id: 'b', title: 'High', score: 90 },
          { id: 'c', title: 'Mid', score: 50 },
        ],
      },
      config,
    );
    expect(insights.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps unscored rows in query order BEHIND the scored ones (stable rank)', () => {
    const insights = insightsOf(
      {
        rows: [
          { id: 'x', title: 'No score first' },
          { id: 'y', title: 'Scored', score: 5 },
          { id: 'z', title: 'No score second' },
        ],
      },
      config,
    );
    expect(insights.map((i) => i.id)).toEqual(['y', 'x', 'z']);
  });

  it('drops rows with no title — an insight with no sentence has nothing to say', () => {
    expect(insightsOf({ rows: [{ id: 'a' }, { id: 'b', title: 'Real' }] }, config).map((i) => i.id)).toEqual([
      'b',
    ]);
  });

  it('narrows the icon/tone columns and caps at the pool size', () => {
    const insights = insightsOf(
      { rows: [{ id: 'a', title: 'T', icon: 'nope', tone: 'nope' }] },
      { ...config, pool: 1 },
    );
    expect(insights[0]?.icon).toBe('sparkles');
    expect(insights[0]?.tone).toBe('accent');
    expect(insightsOf({ rows: [{ title: 'a' }, { title: 'b' }] }, { ...config, pool: 1 })).toHaveLength(1);
  });

  it('honours the configured field names (04 §5)', () => {
    const insights = insightsOf(
      { rows: [{ pk: 'r1', headline: 'Custom', detail: 'Body', rank: 9 }] },
      { ...config, idField: 'pk', titleField: 'headline', bodyField: 'detail', scoreField: 'rank' },
    );
    expect(insights[0]).toMatchObject({ id: 'r1', title: 'Custom', body: 'Body', score: 9 });
  });

  it('returns [] for a malformed payload rather than throwing', () => {
    expect(insightsOf(null, config)).toEqual([]);
    expect(insightsOf({ rows: 'nope' }, config)).toEqual([]);
    expect(insightsOf({ rows: [null, 42] }, config)).toEqual([]);
  });

  it('wraps the visible window around the pool', () => {
    const pool = ['a', 'b', 'c'].map((id) => ({ id, icon: 'sparkles' as const, tone: 'accent' as const, title: id }));
    expect(visibleWindow(pool, 0, 2).map((i) => i.id)).toEqual(['a', 'b']);
    expect(visibleWindow(pool, 2, 2).map((i) => i.id)).toEqual(['c', 'a']); // wraps
    expect(visibleWindow(pool, 0, 99).map((i) => i.id)).toEqual(['a', 'b', 'c']); // never repeats
    expect(visibleWindow([], 0, 2)).toEqual([]);
  });
});

describe('auto-insights — render', () => {
  const rows = [
    { id: 'a', title: 'MRR up 12.4%', body: 'Expansion drove the lift.', tag: 'Revenue', tone: 'pos', icon: 'trend-up', score: 90, href: '/p/mrr' },
    { id: 'b', title: '3 accounts at risk', body: 'Seats fell by half.', tag: 'Churn', tone: 'danger', icon: 'alert', score: 80 },
    { id: 'c', title: 'p95 latency up', body: 'Tracks the reindex.', tag: 'Perf', tone: 'warn', icon: 'trend-down', score: 70 },
    { id: 'd', title: '74% of goal', body: 'On run rate.', tag: 'Pipeline', tone: 'accent', icon: 'target', score: 60 },
  ];

  it('renders the top `count` insights as bullet rows with tag and body', () => {
    const { container } = render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { count: 2 })}
        data={{ rows, total: rows.length }}
        instanceId="i1"
        onEvent={noop}
      />,
    );
    expect(container.querySelectorAll('[data-part="insight-row"]')).toHaveLength(2);
    expect(screen.getByText('MRR up 12.4%')).toBeDefined();
    expect(screen.getByText('Revenue')).toBeDefined();
    expect(screen.queryByText('p95 latency up')).toBeNull(); // outside the window
  });

  it('renders the card-grid variant', () => {
    const { container } = render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { variant: 'cards', count: 2 })}
        data={{ rows, total: rows.length }}
        instanceId="i2"
        onEvent={noop}
      />,
    );
    expect(container.querySelectorAll('[data-part="insight-card"]')).toHaveLength(2);
    expect(container.querySelector('[data-widget]')?.getAttribute('data-variant')).toBe('cards');
  });

  it('Refresh rotates the visible window through the pool', () => {
    render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { count: 2, refreshable: true })}
        data={{ rows, total: rows.length }}
        instanceId="i3"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('MRR up 12.4%')).toBeDefined();
    fireEvent.click(screen.getByText('Refresh'));
    expect(screen.queryByText('MRR up 12.4%')).toBeNull();
    expect(screen.getByText('p95 latency up')).toBeDefined();
  });

  it('hides Refresh when the whole pool already fits (rotation would be a no-op)', () => {
    const { container } = render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { count: 8, refreshable: true })}
        data={{ rows, total: rows.length }}
        instanceId="i4"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('[data-part="insights-refresh"]')).toBeNull();
  });

  it('hides Refresh when refreshable is off', () => {
    const { container } = render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { count: 1, refreshable: false })}
        data={{ rows, total: rows.length }}
        instanceId="i5"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('[data-part="insights-refresh"]')).toBeNull();
  });

  it('the apply CTA emits a drill-through to the row’s href', () => {
    const onEvent = vi.fn();
    render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { count: 1, applyLabel: 'Apply' })}
        data={{ rows, total: rows.length }}
        instanceId="i6"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByText('Apply'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/p/mrr' });
  });

  it('the apply CTA falls back to config.href when the row carries none', () => {
    const onEvent = vi.fn();
    render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { count: 1, applyLabel: 'Apply', href: '/p/insights' })}
        data={{ rows: [rows[1]], total: 1 }}
        instanceId="i7"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByText('Apply'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/p/insights' });
  });

  it('renders no CTA when applyLabel is unset', () => {
    render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { count: 1 })}
        data={{ rows, total: rows.length }}
        instanceId="i8"
        onEvent={noop}
      />,
    );
    expect(screen.queryByText('Apply')).toBeNull();
  });
});

// ── chrome localization ────────────────────────────────────────────────────

describe('kpi chrome localization (ui:widgets.kpi.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { widgets: { kpi: { autoInsights: { refreshLabel: 'Aktualisieren' } } } }
          : null,
    });
    // Two rows with count 1 so the Refresh control (the localized chrome) shows.
    const rows = [
      { id: 'a', title: 'MRR up 12.4%', score: 90 },
      { id: 'b', title: 'p95 latency up', score: 80 },
    ];
    render(
      <I18nProvider i18n={i18n}>
        <AutoInsights
          config={cfg(autoInsightsConfigSchema, { count: 1 })}
          data={{ rows, total: rows.length }}
          instanceId="l10n-1"
          onEvent={noop}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Aktualisieren')).toBeTruthy();

    cleanup();
    render(
      <AutoInsights
        config={cfg(autoInsightsConfigSchema, { count: 1 })}
        data={{ rows, total: rows.length }}
        instanceId="l10n-2"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('Refresh')).toBeTruthy();
  });
});
