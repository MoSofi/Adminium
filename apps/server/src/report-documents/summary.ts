// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card facts (43-report-builder.md D15/D16): what the manager's card,
 * row and thumbnail draw without decoding the body, written by the server on
 * every save. The shape is `reportSummarySchema` in `@adminium/meta` and
 * `ReportSummaryFacts` in the dashboard's `api.ts`, exactly.
 *
 * These ARE the inputs of the comp's `cards` thumbnail (584-591): the accent
 * bar, the report title, up to three KPI boxes from the FIRST `kpi` block,
 * and up to six bars from the FIRST `bar`/`line` block's series. The comp
 * derives them per card by walking every document's blocks; a live list that
 * did that would decode every body to draw a gallery, which is the fault the
 * denormalised column exists to prevent.
 *
 * Re-derived whole on every save, never patched piecemeal (the invoice
 * summary's rule): a summary that can drift from its body is worse than no
 * summary at all.
 */
import type { ReportSummary } from '@adminium/meta';

import type { ReportBody } from './document.js';
import { BLANK_ICON, thumbSeries } from './starters.js';

export interface SummaryContext {
  /** The row's `starter` key's icon, or `file-text` for a blank document (43 D14). */
  starterIcon?: string | undefined;
}

export function summaryOf(body: ReportBody, ctx: SummaryContext = {}): ReportSummary {
  const kpi = body.blocks.find((block) => block.kind === 'kpi');
  return {
    reportTitle: body.reportTitle,
    kicker: body.kicker,
    accent: body.accent,
    blockCount: body.blocks.length,
    // The comp draws `Math.min(3, kpis.length)` boxes, and three when there is
    // no KPI block at all (584) — the thumbnail is a shape, not a reading.
    kpiCount: kpi === undefined ? 3 : Math.min(3, kpi.kpis.length),
    series: thumbSeries(body.blocks),
    starterIcon: ctx.starterIcon ?? BLANK_ICON,
  };
}
