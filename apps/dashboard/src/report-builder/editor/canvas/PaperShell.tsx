// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The paper (comp `cardOuter` 692, `bgScrim` 693, 288-291;
 * 43-report-builder.md Appendix A C1): a 760 px rounded card with an optional
 * full-bleed background image under a white scrim at `bgTint`, and the
 * content above it.
 *
 * ALWAYS LIGHT (D10, 34 S6/DEP-15): the sheet has one palette in both themes
 * — the comp's dark-mode sheet and its dark scrim (`rgba(16,16,20,tint)`,
 * 693) are not built. The document's accent rides `--adm-report-accent` (and
 * its 10 % soft) for every class below; the background image rides a custom
 * property too, because a data URL cannot be a class
 * (`adminium/no-style-prop`'s one escape hatch).
 *
 * THE SHEET NEVER COLLAPSES (D18, as ruled 2026-09-10). The comp's rule is
 * `max-width: 760px` (692) with no minimum, so the sheet simply takes the
 * canvas column's width — which at the `lg` breakpoint, behind the shell rail
 * (256) plus the palette (216) and the inspector (288), leaves 208 px and cuts
 * block content off inside `overflow: hidden` with no way to reach it
 * (measured: a contact e-mail 45 px past the edge, a delivery rail 35 px, a
 * table's amount column 20 px). The comp draws no responsive rule at all
 * (E11), so this is the ruling that fills the silence: keep the comp's squeeze
 * down to {@link SHEET_MIN} and let the CANVAS COLUMN scroll below that,
 * rather than clip. At a comfortable width the picture is the comp's,
 * unchanged.
 */
import type { ReactNode } from 'react';
import { cn } from '@adminium/ui';

import type { ReportBody } from '../../model/envelope.js';

/** The floor the sheet stops squeezing at; below it the canvas column scrolls (D18). */
export const SHEET_MIN = 560;

export interface PaperShellProps {
  body: ReportBody;
  children: ReactNode;
}

export function PaperShell({ body, children }: PaperShellProps) {
  const hasBackground = body.bgImage !== '';
  return (
    <div
      data-testid="report-paper"
      data-background={hasBackground ? '' : undefined}
      style={{
        '--adm-report-accent': body.accent,
        '--adm-report-accent-soft': `color-mix(in srgb, ${body.accent} 10%, transparent)`,
        '--adm-report-bg': hasBackground ? `url("${body.bgImage}")` : 'none',
        '--adm-report-tint': String(body.bgTint),
      }}
      className={cn(
        'adm-always-light relative mx-auto min-h-[600px] w-[760px] min-w-[560px] max-w-full overflow-hidden rounded-2xl border border-[#ececef] bg-white px-[38px] py-[34px] text-[#191920] shadow-card',
        hasBackground && 'bg-[image:var(--adm-report-bg)] bg-cover bg-center',
      )}
    >
      {hasBackground ? <div aria-hidden="true" data-testid="report-scrim" className="absolute inset-0 z-0 bg-[rgba(255,255,255,var(--adm-report-tint))]" /> : null}
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
