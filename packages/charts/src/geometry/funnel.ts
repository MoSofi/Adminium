/**
 * Pure funnel geometry (`chart-funnel`, research/widget-registry.md §2):
 * ordered shrinking stages with two layouts —
 *   - `horizontal`: left-aligned bars, width = value / firstValue;
 *   - `stepped`: centered bars with "N% continue" step-conversion rows.
 * Percentages are of the first stage (overall) and of the previous stage
 * (per-step). DOM-free + deterministic (04 §7.1).
 */

export interface FunnelStageInput {
  label: string;
  value: number;
}

export interface FunnelStage {
  label: string;
  value: number;
  /** Width fraction relative to the FIRST stage (0..1). */
  widthFrac: number;
  /** Percent of the first stage, 0..100. */
  overallPct: number;
  /** Percent retained vs the PREVIOUS stage, 0..100 (first stage = 100). */
  stepPct: number;
  /** Inline-start offset fraction for centered (stepped) layout (0..0.5). */
  offsetFrac: number;
  colorVar: string;
}

export interface FunnelLayout {
  stages: FunnelStage[];
  /** Overall conversion first→last, 0..100. */
  overallConversion: number;
}

function vizAlphaVar(index: number, count: number): string {
  // Fade the accent alpha ramp down the funnel (annex "fading accent alpha").
  if (count <= 1) return 'var(--viz-ramp-6)';
  const step = 6 - Math.round((index / (count - 1)) * 4); // 6 → 2 across stages
  return `var(--viz-ramp-${Math.min(6, Math.max(2, step))})`;
}

/**
 * Funnel stages in input order. Non-finite values clamp to 0; the first
 * positive value is the 100% reference. Returns [] when there is no positive
 * head stage.
 */
export function funnelLayout(input: readonly FunnelStageInput[]): FunnelLayout {
  const stages = input.map((s) => ({ label: s.label, value: Number.isFinite(s.value) ? Math.max(0, s.value) : 0 }));
  const head = stages[0]?.value ?? 0;
  if (stages.length === 0 || head <= 0) return { stages: [], overallConversion: 0 };

  const out: FunnelStage[] = stages.map((stage, i) => {
    const prev = stages[i - 1]?.value ?? head;
    const widthFrac = stage.value / head;
    return {
      label: stage.label,
      value: stage.value,
      widthFrac,
      overallPct: widthFrac * 100,
      stepPct: prev > 0 ? (stage.value / prev) * 100 : 0,
      offsetFrac: (1 - widthFrac) / 2,
      colorVar: vizAlphaVar(i, stages.length),
    };
  });

  const tail = stages.at(-1)?.value ?? 0;
  return { stages: out, overallConversion: (tail / head) * 100 };
}
