// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scale constructors encoding the RTL policy (04-widget-registry.md
 * §7.4 as corrected by 10-i18n-theming.md §5.5):
 *   - horizontal CATEGORICAL scales mirror in RTL (range flipped);
 *   - TIME axes NEVER mirror — oldest left, newest right, inside RTL pages.
 * Geometry stays pure and DOM-free so scheduled-report workers can reuse it.
 */
import { scaleBand, scaleLinear, scalePoint, scaleTime } from 'd3-scale';
import type { ScaleBand, ScaleLinear, ScalePoint, ScaleTime } from 'd3-scale';

export interface CategoricalScaleOptions {
  paddingInner?: number;
  paddingOuter?: number;
}

/** Band scale for bars/columns. Mirrors (range flip) when `rtl` is true. */
export function categoricalBandScale(
  domain: readonly string[],
  width: number,
  rtl: boolean,
  options: CategoricalScaleOptions = {},
): ScaleBand<string> {
  const { paddingInner = 0.3, paddingOuter = 0.15 } = options;
  return scaleBand<string>()
    .domain([...domain])
    .range(rtl ? [width, 0] : [0, width])
    .paddingInner(paddingInner)
    .paddingOuter(paddingOuter);
}

/** Point scale for categorical line charts. Mirrors when `rtl` is true. */
export function categoricalPointScale(domain: readonly string[], width: number, rtl: boolean): ScalePoint<string> {
  return scalePoint<string>()
    .domain([...domain])
    .range(rtl ? [width, 0] : [0, width])
    .padding(0.5);
}

/** Time scale — NEVER mirrored, regardless of direction. */
export function timeScale(domain: readonly [Date, Date], width: number): ScaleTime<number, number> {
  return scaleTime().domain([...domain]).range([0, width]);
}

/** Linear y scale, pixel-down (range [height, 0]). */
export function linearYScale(domain: readonly [number, number], height: number): ScaleLinear<number, number> {
  return scaleLinear().domain([...domain]).range([height, 0]);
}
