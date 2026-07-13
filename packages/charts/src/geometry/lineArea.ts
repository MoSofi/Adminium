/** Pure, DOM-free line/area path builders (d3-shape only). */
import { area, curveLinear, curveMonotoneX, line } from 'd3-shape';

export interface XYPoint {
  /** Pixel-space x. */
  x: number;
  /** Pixel-space y. */
  y: number;
}

/** SVG path for a polyline through pixel-space points. Null when < 1 point. */
export function linePath(points: readonly XYPoint[], smooth = false): string | null {
  const generator = line<XYPoint>()
    .x((d) => d.x)
    .y((d) => d.y)
    .curve(smooth ? curveMonotoneX : curveLinear);
  return generator([...points]);
}

/** SVG path for the area under the line, closed at `baselineY`. */
export function areaPath(points: readonly XYPoint[], baselineY: number, smooth = false): string | null {
  const generator = area<XYPoint>()
    .x((d) => d.x)
    .y0(baselineY)
    .y1((d) => d.y)
    .curve(smooth ? curveMonotoneX : curveLinear);
  return generator([...points]);
}

/**
 * Index of the point whose pixel x is nearest to `targetX`. Works for both
 * ascending (LTR) and descending (RTL categorical) x sequences — linear scan,
 * chart series are small. Returns -1 for empty input.
 */
export function nearestIndexByX(xs: readonly number[], targetX: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const distance = Math.abs((xs[i] ?? Infinity) - targetX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}
