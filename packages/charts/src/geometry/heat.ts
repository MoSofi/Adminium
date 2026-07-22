/**
 * Shared heat-intensity helpers for the matrix/calendar/geo charts (Track E).
 * Pure and DOM-free (04-widget-registry.md §7.1) so scheduled-report
 * workers reuse them. Sequential intensity maps onto the accent alpha ramp
 * `--viz-ramp-1..6` (research/design-system.md §1.3 / tokens viz.css); zero maps
 * to the neutral `--surface-2` empty cell. No hex literals — colors are var()
 * expressions only (acceptance #8).
 */

/** Number of steps in the accent alpha ramp exposed by @adminium/tokens. */
export const RAMP_STEPS = 6;

/**
 * Ramp index (1..RAMP_STEPS) for a heat `level` within a scale of `levels`
 * total levels (level 0 excluded — it is the empty cell). Level `levels-1`
 * always lands on the darkest ramp step.
 */
export function rampIndex(level: number, levels: number): number {
  if (level <= 0) return 0;
  const span = Math.max(1, levels - 1);
  return Math.min(RAMP_STEPS, Math.max(1, Math.round((level / span) * RAMP_STEPS)));
}

/**
 * CSS color for a heat `level`: level 0 → neutral empty cell (`--surface-2`);
 * levels 1..levels-1 → `--viz-ramp-N` accent-alpha steps.
 */
export function rampColorVar(level: number, levels: number): string {
  const index = rampIndex(level, levels);
  return index === 0 ? 'var(--surface-2)' : `var(--viz-ramp-${index})`;
}

/**
 * Discrete heat level 0..levels-1 for a `value` over `[0, maxValue]`. Zero (or
 * non-positive) values are level 0 (empty); positive values span 1..levels-1
 * linearly, with `maxValue` landing on the top level. `levels` must be ≥ 2.
 */
export function heatLevel(value: number, maxValue: number, levels: number): number {
  if (value <= 0 || maxValue <= 0 || levels < 2) return 0;
  const frac = Math.min(1, value / maxValue);
  const bucket = Math.min(levels - 2, Math.floor(frac * (levels - 1)));
  return 1 + bucket;
}

/**
 * Whether tile label text should flip to the on-accent color (`--accent-fg`):
 * true once the ramp step is dark enough (≥ 65% alpha, ramp index ≥ 4) to lose
 * contrast against the default foreground.
 */
export function heatTextLight(level: number, levels: number): boolean {
  return rampIndex(level, levels) >= 4;
}
