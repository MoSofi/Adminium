// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two pills every card and row carries (comp 1436-1443): the language
 * code in mono — `EN`, uppercased as the comp prints it (1437) — and the
 * stored status in its tone.
 */
import { Badge, cn } from '@adminium/ui';

import type { InvoiceLang, InvoiceStatus } from '../api.js';
import { languageMeta } from '../model/languages.js';
import { STATUS_TONE, languageLabel, statusLabel } from './model.js';

export function LangPill({ lang, className }: { lang: InvoiceLang; className?: string | undefined }) {
  const label = `${languageMeta(lang).native} · ${languageLabel(lang)}`;
  return (
    <span
      data-testid="invoices-lang"
      data-lang={lang}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center rounded-[5px] bg-surface-3 px-1.5 py-0.5 font-mono text-[9.5px] font-extrabold tracking-[.04em] text-fg-muted',
        className,
      )}
    >
      {lang.toUpperCase()}
    </span>
  );
}

export function DocumentStatusPill({ status }: { status: InvoiceStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-testid="invoices-status" data-status={status} className="shrink-0 px-[9px] text-[10px]">
      {statusLabel(status)}
    </Badge>
  );
}
