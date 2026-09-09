// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card's thumbnail — a miniature of the sheet (43-report-builder.md
 * Appendix A M10; comp 181-187, props 584-591): a 34 × 5 accent kicker bar,
 * the report title at 11 px / 800, up to three KPI boxes each holding a 60 %
 * bar at 50 % accent, then up to six bars whose heights are
 * `max(14, v/max·100)%` with the LAST in full accent and the rest at 30 %.
 *
 * It is drawn from the row's denormalised summary, never from the body
 * (43 D15/D16): the comp derives these numbers by walking every document's
 * blocks, and a live gallery that did that would decode every body to paint
 * itself.
 *
 * The heights are DATA, so they ride inline `style` on a `--h` custom
 * property rather than a class; the accent rides `--adm-report-accent` and
 * the classes read it back. The paper follows the THEME here — the comp
 * paints it `var(--surface)` — because this is a thumbnail in the manager,
 * not the always-light sheet (43 D10).
 */
import type { ReportSummaryFacts } from '../api.js';

/** The comp's `Math.max(14, v / max * 100)` (591), with the comp's `|| 100` guard. */
export function barHeights(series: readonly number[]): number[] {
  const max = series.length === 0 ? 0 : Math.max(...series);
  const denominator = max === 0 ? 100 : max;
  return series.slice(0, 6).map((value) => Math.max(14, (value / denominator) * 100));
}

export function ReportMiniPreview({ summary }: { summary: ReportSummaryFacts }) {
  const heights = barHeights(summary.series);
  const kpis = Math.max(0, Math.min(3, Math.trunc(summary.kpiCount)));
  return (
    <div
      data-testid="report-mini-preview"
      className="flex min-h-[120px] flex-col gap-1.5 rounded-t-[8px] border border-border bg-surface p-[13px]"
      style={{ '--adm-report-accent': summary.accent }}
    >
      <div className="h-[5px] w-[34px] shrink-0 rounded-[3px] bg-[var(--adm-report-accent)]" aria-hidden="true" />
      <div data-testid="report-mini-title" className="text-[11px] font-extrabold leading-[1.25] tracking-[-.01em] text-fg">
        {summary.reportTitle}
      </div>
      <div data-testid="report-mini-kpis" className="mt-[3px] flex gap-1.5" aria-hidden="true">
        {Array.from({ length: kpis }, (_, index) => (
          <div key={index} className="flex h-5 flex-1 items-center rounded-[5px] border border-border bg-surface-2 px-[5px]">
            <div className="h-1 w-[60%] rounded-sm bg-[color-mix(in_srgb,var(--adm-report-accent)_50%,transparent)]" />
          </div>
        ))}
      </div>
      <div data-testid="report-mini-bars" className="mt-auto flex h-[30px] items-end gap-1" aria-hidden="true">
        {heights.map((height, index) => (
          <div
            key={index}
            style={{ '--h': `${String(height)}%` }}
            className={
              index === heights.length - 1
                ? 'h-[var(--h)] flex-1 rounded-t-[3px] bg-[var(--adm-report-accent)]'
                : 'h-[var(--h)] flex-1 rounded-t-[3px] bg-[color-mix(in_srgb,var(--adm-report-accent)_30%,transparent)]'
            }
          />
        ))}
      </div>
    </div>
  );
}
