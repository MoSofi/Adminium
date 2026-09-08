// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card's thumbnail — a miniature of the sheet (34-invoices-add-on.md
 * Appendix E §M10; comp 245-250, props 1432-1449): the accent logo chip with
 * the brand word and the title word, two skeleton address rules, one row per
 * line item (three at most) whose amount bar cycles 30/40/50 px at 55 %
 * accent, and the TOTAL line in accent mono. It is drawn from the row's
 * denormalised summary, never from the body (§3.9).
 *
 * The accent is DATA, so it rides the `--adm-invoice-accent` custom property
 * and the classes read it back; there is no `style` colour. The chip's white
 * glyph is the comp's own `#fff` (1445). The paper follows the theme here —
 * the comp paints it `var(--surface)` — because this is a thumbnail of the
 * manager, not the always-light sheet (§S6).
 */
import { Hexagon } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { InvoiceSummaryFacts } from '../api.js';
import { invoiceIcon } from '../icons.js';
import { formatMoney } from '../model/money.js';
import { previewRowCount } from './model.js';

/** The comp's `(30 + (i % 3) * 10) + 'px'` (1432). */
const AMOUNT_WIDTH = ['w-[30px]', 'w-[40px]', 'w-[50px]'] as const;

export function InvoiceMiniPreview({ summary }: { summary: InvoiceSummaryFacts }) {
  const Mark = summary.logoIcon === '' ? Hexagon : invoiceIcon(summary.logoIcon);
  const rows = previewRowCount(summary);
  return (
    <div
      data-testid="invoices-mini-preview"
      className="flex min-h-[118px] flex-col gap-[7px] rounded-t-lg border border-border bg-surface px-[13px] py-3 shadow-[0_-1px_0_var(--border)]"
      style={{ '--adm-invoice-accent': summary.accent }}
    >
      <div className="flex items-center gap-1.5">
        <div className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-[var(--adm-invoice-accent)] text-white">
          <Mark className="size-[11px]" aria-hidden="true" />
        </div>
        <span className="truncate text-[8.5px] font-extrabold tracking-[-.01em] text-fg">{summary.logoText}</span>
        <span className="ms-auto shrink-0 text-[9px] font-extrabold tracking-[.04em] text-fg-subtle">{summary.title}</span>
      </div>
      <div className="mt-px flex flex-col gap-[3px]" aria-hidden="true">
        <div className="h-[3.5px] w-[60%] rounded-sm bg-border-strong" />
        <div className="h-[3.5px] w-[46%] rounded-sm bg-border-strong" />
      </div>
      <div data-testid="invoices-mini-rows" className="mt-0.5 flex flex-col gap-[5px]" aria-hidden="true">
        {AMOUNT_WIDTH.slice(0, rows).map((width) => (
          <div key={width} className="flex items-center gap-1.5">
            <div className="h-[3.5px] flex-1 rounded-sm bg-surface-3" />
            <div className={`h-[3.5px] rounded-sm bg-[color-mix(in_srgb,var(--adm-invoice-accent)_55%,transparent)] ${width}`} />
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-border pt-[5px]">
        <span className="text-[8px] font-bold text-fg-subtle">{t('invoices:card.total', 'TOTAL')}</span>
        {/* The comp's `thumbTotalStyle` (1448) paints the raw document accent. On the
            theme's DARK surface behind this thumbnail that is 2.91:1 and fails WCAG
            AA (the comp's own dark mode has it too), so the dark variant lifts the
            same accent towards `--fg` — the light picture is unchanged. */}
        <span
          data-testid="invoices-mini-total"
          className="font-mono text-[11px] font-extrabold text-[var(--adm-invoice-accent)] dark:text-[color-mix(in_srgb,var(--adm-invoice-accent)_40%,var(--fg))]"
        >
          {formatMoney(summary.totalMinor, summary.currency, summary.cents)}
        </span>
      </div>
    </div>
  );
}
