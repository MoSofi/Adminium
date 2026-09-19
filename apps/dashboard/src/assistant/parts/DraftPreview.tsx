// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record preview: what a drafted invoice would BE, rather than what it
 * would look like on paper.
 *
 * The one preview that is not a sheet. The other three pages hand in their
 * own — the same renderer their editor uses — but a record has no sheet until
 * it is a document, and the fields that matter before it exists are the
 * account, the template, the period and the total. That is what the comp chose
 * to show here, and it stays. It lives in this tree because nothing about it
 * is a page's own, and the page that wants it hands it in like any other.
 *
 * WHAT IS NOT CLAIMED. The comp's *Marks as billed: 38 time_entries rows* is
 * not built, because nothing here writes a customer row. The row says so.
 *
 * THE MONEY IS NOT COMPUTED HERE. The amounts and the total arrive already
 * formatted, from the page that owns the arithmetic — one law, integer minor
 * units, the same cents on every runtime. A second copy of it in this tree
 * would disagree with the document the save writes on the first rounding
 * anybody argued about, and the model's own arithmetic is never shown at all.
 */
import { t } from '../../i18n/t.js';

export interface DraftPreviewProps {
  /** The artefact the turn produced, in the invoice page's own format. */
  artefact: Record<string, unknown>;
  /** The template this draft was built from, by name. */
  basedOnLabel: string | null;
  /** Each line's amount, formatted by the page's own money law, in `items` order. */
  amounts: readonly string[];
  /** The document total, by that same law. */
  total: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

interface Line {
  desc: string;
  from: string;
  qty: string;
  amount: string;
}

function linesOf(body: Record<string, unknown>, amounts: readonly string[]): Line[] {
  const items = Array.isArray(body.items) ? body.items : [];
  return items.map((entry, index) => {
    const item = record(entry);
    return {
      desc: str(item.desc, str(item.name, '')),
      from: str(item.from, ''),
      qty: str(item.qty, ''),
      // An artefact with more lines than the host priced is a disagreement
      // about the document, not something to paper over with the model's
      // own figure.
      amount: amounts[index] ?? '—',
    };
  });
}

export function DraftPreview({ artefact, basedOnLabel, amounts, total }: DraftPreviewProps) {
  const body = record(artefact.body);
  const lines = linesOf(body, amounts);
  const fields = [
    { label: t('assistant:draft.account', 'Account'), value: str(body.customerName) },
    { label: t('assistant:draft.template', 'Template'), value: basedOnLabel ?? '—' },
    { label: t('assistant:draft.issued', 'Issued'), value: str(body.issued) },
    { label: t('assistant:draft.due', 'Due'), value: str(body.due) },
    { label: t('assistant:draft.status', 'Status'), value: t('assistant:draft.draft', 'draft') },
  ];
  return (
    <div className="px-[18px] pb-[18px] pt-4">
      <dl className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
        {fields.map((field) => (
          <div key={field.label} className="bg-surface px-[13px] py-[11px]">
            <dt className="text-[10px] font-extrabold uppercase tracking-[.07em] text-fg-muted">{field.label}</dt>
            <dd className="mt-[5px] text-body-sm font-bold leading-[1.35] text-fg">{field.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3.5 overflow-hidden rounded-[12px] border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-[13px] py-[9px]">
          <span className="flex-1 text-[10px] font-extrabold uppercase tracking-[.07em] text-fg-muted">
            {t('assistant:draft.lines', 'Pulled line items')}
          </span>
          <span className="text-[10.5px] text-fg-muted">
            {t('assistant:draft.lineCount', '{n, plural, one {# line} other {# lines}}', { n: lines.length })}
          </span>
        </div>
        {lines.map((line, index) => (
          <div
            key={`${String(index)}:${line.desc}`}
            className="flex items-center gap-3 border-b border-border px-[13px] py-2.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm font-semibold text-fg">{line.desc}</span>
              {line.from === '' ? null : (
                <span className="mt-0.5 block text-[11px] text-fg-muted">{line.from}</span>
              )}
            </span>
            <span className="w-16 text-end font-mono text-[12px] text-fg-muted">{line.qty}</span>
            <span className="w-[84px] text-end font-mono text-[12px] font-bold text-fg">{line.amount}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 border-b border-border px-[13px] py-2.5">
          <span className="flex-1 text-[12px] font-bold text-fg">{t('assistant:draft.total', 'Total')}</span>
          <span data-testid="assistant-draft-total" className="font-mono text-[15px] font-bold text-fg">
            {total}
          </span>
        </div>
        <p className="bg-surface-2 px-[13px] py-[11px] text-[11px] leading-[1.5] text-fg-muted">
          {t('assistant:draft.notTouched', 'No customer rows are changed, and no email is sent.')}
        </p>
      </div>
    </div>
  );
}
