// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure radar geometry (`chart-radar`, research/widget-registry.md §2): N named
 * axes arranged on a regular polygon, one polygon per series (current vs an
 * optional target overlay), normalized to a shared max. First axis points up
 * (12 o'clock); subsequent axes step clockwise (LTR) or counter-clockwise (RTL)
 * so the categorical axis order mirrors per §7.4. DOM-free + deterministic.
 */

export interface RadarSeriesInput {
  label: string;
  /** One value per axis, in axis order. */
  values: readonly number[];
}

export interface RadarPoint {
  x: number;
  y: number;
}

export interface RadarAxis {
  label: string;
  /** Outer vertex of the axis spoke (on the unit ring). */
  point: RadarPoint;
  angle: number;
}

export interface RadarSeries {
  label: string;
  points: RadarPoint[];
  /** Closed polygon path string (`M … Z`). */
  path: string;
  colorVar: string;
}

export interface RadarGridRing {
  /** 0..1 level. */
  level: number;
  /** Polygon vertices for this concentric level. */
  points: RadarPoint[];
  path: string;
}

export interface RadarLayout {
  axes: RadarAxis[];
  series: RadarSeries[];
  rings: RadarGridRing[];
  radius: number;
  center: RadarPoint;
  /** Domain max the values were normalized against. */
  max: number;
}

export interface RadarOptions {
  size: number;
  /** Concentric grid rings (default 4). */
  levels?: number;
  /** Explicit domain max; defaults to the max value across all series (min 1). */
  max?: number;
  rtl?: boolean;
}

function vizColor(index: number): string {
  return `var(--viz-${(index % 8) + 1})`;
}

function angleFor(index: number, count: number, rtl: boolean): number {
  // Start at 12 o'clock (-90°); step clockwise (LTR) or CCW (RTL).
  const step = (Math.PI * 2) / count;
  return -Math.PI / 2 + (rtl ? -1 : 1) * index * step;
}

function polygonPath(points: readonly RadarPoint[]): string {
  if (points.length === 0) return '';
  return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('')}Z`;
}

/**
 * Radar polygons for 1–2 series over `axisLabels`. Series values are truncated
 * or zero-padded to the axis count. Returns empty axes/series when there are
 * fewer than 3 axes (a polygon needs ≥3 vertices).
 */
export function radarLayout(
  axisLabels: readonly string[],
  seriesInput: readonly RadarSeriesInput[],
  options: RadarOptions,
): RadarLayout {
  const { size, levels = 4, rtl = false } = options;
  const count = axisLabels.length;
  const radius = Math.max(0, size / 2);
  const center: RadarPoint = { x: radius, y: radius };

  if (count < 3 || radius <= 0) {
    return { axes: [], series: [], rings: [], radius, center, max: 1 };
  }

  const domainMax =
    options.max ??
    Math.max(
      1,
      ...seriesInput.flatMap((s) => s.values.map((v) => (Number.isFinite(v) ? v : 0))),
    );

  const angles = Array.from({ length: count }, (_, i) => angleFor(i, count, rtl));

  const axes: RadarAxis[] = axisLabels.map((label, i) => {
    const angle = angles[i] as number;
    return {
      label,
      angle,
      point: { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius },
    };
  });

  const rings: RadarGridRing[] = Array.from({ length: levels }, (_, l) => {
    const level = (l + 1) / levels;
    const points = angles.map((angle) => ({
      x: center.x + Math.cos(angle) * radius * level,
      y: center.y + Math.sin(angle) * radius * level,
    }));
    return { level, points, path: polygonPath(points) };
  });

  const series: RadarSeries[] = seriesInput.map((s, si) => {
    const points = angles.map((angle, i) => {
      const raw = s.values[i];
      const v = Number.isFinite(raw) ? Math.max(0, raw as number) : 0;
      const norm = Math.min(1, v / domainMax);
      return {
        x: center.x + Math.cos(angle) * radius * norm,
        y: center.y + Math.sin(angle) * radius * norm,
      };
    });
    return { label: s.label, points, path: polygonPath(points), colorVar: vizColor(si) };
  });

  return { axes, series, rings, radius, center, max: domainMax };
}
