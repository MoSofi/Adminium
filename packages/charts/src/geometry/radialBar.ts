/**
 * Pure radial-bar geometry (`chart-radial-bar`, research/widget-registry.md §2):
 * concentric progress rings, one per category (≤4), each a stroke-dashoffset
 * sweep of its percent from 12 o'clock clockwise. DOM-free + deterministic so
 * the same arc paths render in Node and the browser (04 §7.1).
 *
 * Rings never mirror in RTL (clockwise rotation is direction-neutral, like the
 * donut §7.4) — only the surrounding legend flips, which is plain flex CSS.
 */
import { arc } from 'd3-shape';

const TAU = Math.PI * 2;

export interface RadialBarInput {
  label: string;
  /** Percent 0..100 (values are clamped). */
  value: number;
}

export interface RadialBarRing {
  label: string;
  value: number;
  /** 0..1 clamped fraction. */
  fraction: number;
  radius: number;
  /** Background track arc (full ring), centered on (0,0). */
  trackPath: string;
  /** Foreground value arc from 12 o'clock clockwise. */
  valuePath: string;
  colorVar: string;
}

export interface RadialBarOptions {
  /** Outer diameter in px. */
  size: number;
  thickness?: number;
  /** Gap between concentric rings in px (default 6). */
  gap?: number;
}

function vizColor(index: number): string {
  return `var(--viz-${(index % 8) + 1})`;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 100));
}

/**
 * Concentric rings from the outside in, in input order. An empty input (or
 * non-positive size) yields []. Each ring's value arc sweeps clockwise from the
 * top; a zero-percent ring has an empty value path.
 */
export function radialBarRings(input: readonly RadialBarInput[], options: RadialBarOptions): RadialBarRing[] {
  const { size, thickness = 12, gap = 6 } = options;
  if (size <= 0 || input.length === 0) return [];

  const outer = size / 2;
  return input.map((item, index) => {
    const radius = outer - index * (thickness + gap) - thickness / 2;
    const r = Math.max(0, radius);
    const inner = Math.max(0, r - thickness / 2);
    const outerR = r + thickness / 2;
    const fraction = clampFraction(item.value);

    const track = arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(inner)
      .outerRadius(outerR)
      .cornerRadius(thickness / 2);
    const trackPath = track({ startAngle: 0, endAngle: TAU }) ?? '';
    const valuePath =
      fraction > 0 ? (track({ startAngle: 0, endAngle: fraction * TAU }) ?? '') : '';

    return {
      label: item.label,
      value: item.value,
      fraction,
      radius: r,
      trackPath,
      valuePath,
      colorVar: vizColor(index),
    };
  });
}
