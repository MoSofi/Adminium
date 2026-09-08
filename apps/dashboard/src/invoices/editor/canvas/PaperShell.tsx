// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The paper (comp `cardOuter` 1732, `bgScrim` 1733, 367-369, 723; 34-
 * invoices-add-on.md Appendix E §C1, §C11): an 800 px rounded card with an
 * optional full-bleed background image under a white scrim at `bgTint`, the
 * content above it, and the stamp/seal painted as the card's LAST child —
 * absolute, bottom-right, 104 px, 90 %, click-through, above every block and
 * outside `blockOrder`.
 *
 * ALWAYS LIGHT (S6): the sheet has one palette in both themes — the comp's
 * dark-mode sheet (a dark scrim at 1733) is not built. The document's accent
 * rides `--adm-invoice-accent` (and its 10 % soft) for every class below;
 * the images ride custom properties too, because a data URL cannot be a
 * class (`adminium/no-style-prop`'s one escape hatch).
 */
import type { ReactNode } from 'react';
import { cn } from '@adminium/ui';

import type { InvoiceBody } from '../../model/envelope.js';

export interface PaperShellProps {
  body: InvoiceBody;
  children: ReactNode;
}

export function PaperShell({ body, children }: PaperShellProps) {
  const hasBackground = body.bgImage !== '';
  const hasStamp = body.stampImage !== '';
  return (
    <div
      data-testid="invoices-paper"
      data-background={hasBackground ? '' : undefined}
      style={{
        '--adm-invoice-accent': body.accent,
        '--adm-invoice-accent-soft': `color-mix(in srgb, ${body.accent} 10%, transparent)`,
        '--adm-invoice-bg': hasBackground ? `url("${body.bgImage}")` : 'none',
        '--adm-invoice-tint': String(body.bgTint),
        '--adm-invoice-stamp': hasStamp ? `url("${body.stampImage}")` : 'none',
      }}
      className={cn(
        'adm-always-light relative mx-auto max-w-[800px] overflow-hidden rounded-2xl border border-[#ececef] bg-white px-11 py-10 text-[#191920] shadow-card',
        hasBackground && 'bg-[image:var(--adm-invoice-bg)] bg-cover bg-center',
      )}
    >
      {hasBackground ? <div aria-hidden="true" data-testid="invoices-scrim" className="absolute inset-0 z-0 bg-[rgba(255,255,255,var(--adm-invoice-tint))]" /> : null}
      <div className="relative z-[1]">{children}</div>
      {hasStamp ? (
        <div
          aria-hidden="true"
          data-testid="invoices-stamp"
          className="pointer-events-none absolute bottom-[18px] end-[18px] z-[2] size-[104px] bg-[image:var(--adm-invoice-stamp)] bg-contain bg-center bg-no-repeat opacity-90"
        />
      ) : null}
    </div>
  );
}
