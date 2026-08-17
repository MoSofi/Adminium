// SPDX-License-Identifier: AGPL-3.0-only
import type { Tone } from '@adminium/ui';

import { formatMetricValue } from '../../lib/format.js';
import type { MetricFormat, MetricFormatOptions } from '../../lib/format.js';

/**
 * Shared helpers for the `kpi` family (annex §1) — SVG gauge geometry, the
 * qualitative band vocabulary the gauges tint against, the `micro-kpi-subtitle`
 * template interpolator, and the `stat-pair-card` derived-metric arithmetic.
 *
 * PURE module: no JSX, no @adminium/ui component imports, no React. The
 * registry's EAGER metadata graph reaches this file through `kpi-config.ts`, so
 * nothing here may drag component code into the eager chunk (04 §2.3;
 * enforced by `qa/chunk-budget.test.ts`). Icon ELEMENTS live in `kpi-icons.tsx`.
 * `import type { Tone }` is erased at compile time, so it carries no runtime
 * edge into @adminium/ui.
 *
 * DIRECTIONALITY (10-i18n-theming.md §5.2, and the @adminium/charts donut /
 * radial-bar policy verbatim): gauge geometry NEVER mirrors under RTL. A
 * clockwise sweep and a 180° speedometer arc are rotational, not directional —
 * mirroring them would read as "the needle runs backwards", exactly as it would
 * for a donut. Only the surrounding chrome (labels, captions, footers, the
 * cluster grid) flips, which is plain logical-property CSS. The stories capture
 * both directions to prove the chrome genuinely mirrors while the canvas holds.
 */

/** Fixed demo epoch so `demoData(seed)` is byte-identical across runs (04 §7.7). */
export const KPI_DEMO_EPOCH = Date.UTC(2026, 6, 14, 12, 0, 0);

// ── Qualitative bands ───────────────────────────────────────────────────────

/**
 * A qualitative gauge band (annex §1 `bands` [{to, color, label}]). `to` is the
 * INCLUSIVE upper cutoff in the gauge's own value space (not a percent), `tone`
 * names a semantic token — never a raw colour, so bands re-theme with the app.
 * `kpi-config.ts` mirrors this as its Zod schema.
 */
export interface GaugeBand {
  to: number;
  tone: Tone;
  label?: string | undefined;
}

/** The annex's default health bands (danger → warn → pos) over a 0–100 score. */
export const DEFAULT_GAUGE_BANDS: readonly GaugeBand[] = [
  { to: 50, tone: 'danger', label: 'Critical' },
  { to: 75, tone: 'warn', label: 'Degraded' },
  { to: 100, tone: 'pos', label: 'Healthy' },
];

/**
 * The band a value falls in — the first band whose `to` is at or above it,
 * scanning in ascending cutoff order. A value above every cutoff takes the
 * highest band (a gauge is always tinted); an empty band list returns null.
 */
export function bandFor(value: number, bands: readonly GaugeBand[]): GaugeBand | null {
  if (bands.length === 0) return null;
  const ordered = [...bands].sort((a, b) => a.to - b.to);
  return ordered.find((band) => value <= band.to) ?? (ordered[ordered.length - 1] as GaugeBand);
}

/** Clamp a raw value into `[0, max]`; non-finite input reads as 0. */
export function clampValue(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  const upper = max > 0 ? max : 100;
  return Math.min(Math.max(value, 0), upper);
}

/** Clamped `[0, 1]` fraction of `max`. */
export function fractionOf(value: number, max: number): number {
  const upper = max > 0 ? max : 100;
  return clampValue(value, upper) / upper;
}

// ── gauge-ring geometry (annex §1) ──────────────────────────────────────────

export type GaugeSize = 'sm' | 'md' | 'lg';

/** Outer diameter + stroke thickness per `size` (annex §1 `size`). */
export const RING_SIZES: Record<GaugeSize, { size: number; thickness: number }> = {
  sm: { size: 96, thickness: 8 },
  md: { size: 132, thickness: 11 },
  lg: { size: 168, thickness: 14 },
};

export interface RingGeometry {
  /** Square viewBox edge in px. */
  size: number;
  center: number;
  radius: number;
  thickness: number;
  /** 2πr — the `stroke-dasharray` of both the track and the value stroke. */
  circumference: number;
  /** `stroke-dashoffset` for the value stroke at rest (fully swept). */
  dashOffset: number;
  fraction: number;
}

/**
 * `gauge-ring`'s stroke-dashoffset geometry (annex §1). The value stroke starts
 * fully offset (invisible) and animates to `dashOffset`; the caller rotates the
 * circle -90° so the sweep begins at 12 o'clock.
 */
export function gaugeRingGeometry(value: number, max: number, size: GaugeSize = 'md'): RingGeometry {
  const { size: edge, thickness } = RING_SIZES[size];
  const radius = (edge - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = fractionOf(value, max);
  return {
    size: edge,
    center: edge / 2,
    radius,
    thickness,
    circumference,
    dashOffset: circumference * (1 - fraction),
    fraction,
  };
}

// ── gauge-arc geometry (annex §1) ───────────────────────────────────────────

/**
 * A point on the gauge circle. Angles are degrees in SVG space (y grows DOWN):
 * 180° points at -x (the arc's start, inline-start in an unmirrored canvas),
 * 270° points at -y (straight up), 360° points at +x (the arc's end). Sweeping
 * 180 → 360 therefore traces left → top → right.
 */
export function polarPoint(cx: number, cy: number, radius: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

/** An SVG `A` (elliptical-arc) path between two angles on the same circle. */
export function arcPath(cx: number, cy: number, radius: number, fromDeg: number, toDeg: number): string {
  const sweep = Math.abs(toDeg - fromDeg);
  if (radius <= 0 || sweep < 0.01) return '';
  const start = polarPoint(cx, cy, radius, fromDeg);
  const end = polarPoint(cx, cy, radius, toDeg);
  const largeArc = sweep > 180 ? 1 : 0;
  const clockwise = toDeg >= fromDeg ? 1 : 0;
  return `M ${round(start.x)} ${round(start.y)} A ${round(radius)} ${round(radius)} 0 ${largeArc} ${clockwise} ${round(end.x)} ${round(end.y)}`;
}

/** 3-dp rounding so the same path string renders in Node and the browser. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The gauge's 180° speedometer sweep, in the `polarPoint` angle space. */
const ARC_START_DEG = 180;
const ARC_END_DEG = 360;

export interface ArcBandSegment {
  path: string;
  tone: Tone;
  label?: string | undefined;
}

export interface ArcGeometry {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius: number;
  thickness: number;
  /** Full 180° background sweep. */
  trackPath: string;
  /** Value sweep from the arc's start to the needle. */
  valuePath: string;
  /** Per-band coloured segments across the track (annex §1 `bands`). */
  bandSegments: ArcBandSegment[];
  /** Needle tip; the tail sits at (cx, cy). */
  needle: { x: number; y: number };
  fraction: number;
}

/**
 * `gauge-arc`'s 180° speedometer geometry (annex §1): a background sweep, one
 * coloured segment per band, the value sweep, and the needle tip. Deterministic
 * and DOM-free — the same paths render in Node (scheduled reports) and the
 * browser (04 §7.1).
 */
export function gaugeArcGeometry(
  value: number,
  max: number,
  bands: readonly GaugeBand[],
  options: { width?: number; thickness?: number } = {},
): ArcGeometry {
  const width = options.width ?? 180;
  const thickness = options.thickness ?? 12;
  const radius = Math.max(0, (width - thickness) / 2);
  const cx = width / 2;
  const cy = radius + thickness / 2;
  // A 180° arc plus the stroke, with headroom under the baseline for the value.
  const height = cy + thickness / 2;
  const fraction = fractionOf(value, max);
  const needleDeg = ARC_START_DEG + fraction * (ARC_END_DEG - ARC_START_DEG);

  const upper = max > 0 ? max : 100;
  const ordered = [...bands].sort((a, b) => a.to - b.to);
  const bandSegments: ArcBandSegment[] = [];
  let cursor = 0;
  for (const band of ordered) {
    const to = Math.min(Math.max(band.to, 0), upper);
    if (to <= cursor) continue;
    bandSegments.push({
      path: arcPath(
        cx,
        cy,
        radius,
        ARC_START_DEG + (cursor / upper) * 180,
        ARC_START_DEG + (to / upper) * 180,
      ),
      tone: band.tone,
      label: band.label,
    });
    cursor = to;
  }

  return {
    width,
    height,
    cx,
    cy,
    radius,
    thickness,
    trackPath: arcPath(cx, cy, radius, ARC_START_DEG, ARC_END_DEG),
    valuePath: arcPath(cx, cy, radius, ARC_START_DEG, needleDeg),
    bandSegments,
    needle: polarPoint(cx, cy, radius - thickness, needleDeg),
    fraction,
  };
}

// ── micro-kpi-subtitle (annex §1) ───────────────────────────────────────────

/**
 * A scalar bag narrowed off a `single-metric` payload: `value` plus any sibling
 * numeric/string columns the header line interpolates ("3 unread · 10 total").
 */
export type ScalarBag = Record<string, number | string>;

/** `{placeholder}` tokens, non-greedy so `{a} {b}` reads as two tokens. */
const TOKEN_RE = /\{([a-zA-Z0-9_.-]+)\}/g;

/**
 * Interpolate a `micro-kpi-subtitle` template against the bound scalars (annex
 * §1 `template`). Numeric scalars route through the Intl metric formatter (so
 * "1.2k"/"74%" localize); string scalars pass through verbatim.
 *
 * An UNKNOWN placeholder resolves to the empty string rather than leaking the
 * raw `{token}` into the header — a stored template that outlives its binding
 * (renamed column, swapped data source) must degrade to a shorter sentence, not
 * to visible template syntax. `templateKeys` lets the builder show which tokens
 * a template needs.
 */
export function interpolateTemplate(
  template: string,
  scalars: ScalarBag,
  format: MetricFormat = 'plain',
  opts: MetricFormatOptions = {},
): string {
  return template.replace(TOKEN_RE, (_match, key: string) => {
    const scalar = scalars[key];
    if (scalar === undefined) return '';
    return typeof scalar === 'number' ? formatMetricValue(scalar, format, opts) : scalar;
  });
}

/** The placeholder names a template references, in first-appearance order. */
export function templateKeys(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(TOKEN_RE)) {
    const key = match[1];
    if (key !== undefined) seen.add(key);
  }
  return [...seen];
}

// ── stat-pair-card (annex §1) ───────────────────────────────────────────────

/**
 * The closed derived-metric vocabulary (annex §1 `derivedFormula` — "second may
 * be a formula over the first", e.g. LTV = MRR × lifetime months). Deliberately
 * an ENUM of four arithmetic ops rather than an expression string: a stored
 * dashboard config must never be able to smuggle evaluable code into the
 * renderer.
 */
export const DERIVED_OPS = ['none', 'add', 'subtract', 'multiply', 'divide'] as const;
export type DerivedOp = (typeof DERIVED_OPS)[number];

/**
 * Apply a derived formula to side A. Returns null for `none` (side B comes from
 * the payload instead) and for a divide-by-zero / non-finite result, so the card
 * renders an em-dash rather than "Infinity".
 */
export function applyDerived(a: number, op: DerivedOp, operand: number): number | null {
  if (op === 'none') return null;
  const result =
    op === 'add' ? a + operand : op === 'subtract' ? a - operand : op === 'multiply' ? a * operand : a / operand;
  return Number.isFinite(result) ? result : null;
}

// ── auto-insights (annex §1) ────────────────────────────────────────────────

/**
 * The insight glyph vocabulary (annex §1: "sparkles icon", "tone icon"). Closed
 * set — `kpi-icons.tsx` maps each key to a Lucide element, and an unrecognised
 * `icon` column value falls back to `sparkles`.
 */
export const INSIGHT_ICONS = [
  'sparkles',
  'trend-up',
  'trend-down',
  'alert',
  'info',
  'target',
  'zap',
  'lightbulb',
] as const;
export type InsightIcon = (typeof INSIGHT_ICONS)[number];

const INSIGHT_ICON_SET: ReadonlySet<string> = new Set(INSIGHT_ICONS);

/** Narrow a raw `icon` column value to the closed vocabulary. */
export function insightIconOf(value: unknown): InsightIcon {
  return typeof value === 'string' && INSIGHT_ICON_SET.has(value) ? (value as InsightIcon) : 'sparkles';
}

const TONE_SET: ReadonlySet<string> = new Set(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

/** Narrow a raw `tone` column value to the semantic tone vocabulary. */
export function toneOf(value: unknown, fallback: Tone = 'accent'): Tone {
  return typeof value === 'string' && TONE_SET.has(value) ? (value as Tone) : fallback;
}

/**
 * The SHARED config's `tone` (04 §2.1) → the @adminium/ui `Tone` vocabulary.
 * The two enums are deliberately not identical: the shared config offers
 * `muted` (the widget-author-facing name for "no emphasis") where the component
 * layer calls the same thing `neutral`, and the shared enum has no `neutral` at
 * all. Widening the config enum would change a stored-config contract, so the
 * translation lives here — `undefined` falls back to the caller's default.
 */
export function sharedToneOf(
  tone: 'accent' | 'pos' | 'warn' | 'danger' | 'info' | 'muted' | undefined,
  fallback: Tone,
): Tone {
  if (tone === undefined) return fallback;
  return tone === 'muted' ? 'neutral' : tone;
}
