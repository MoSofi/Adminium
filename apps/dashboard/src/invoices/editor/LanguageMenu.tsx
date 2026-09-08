// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The header's language button and its menu (comp 344-356, 1617-1634;
 * 34-invoices-add-on.md Appendix E §E6, O23): `{CODE} ▾` opens *Language
 * variations* — one row per DOCUMENT language (the comp's six, `model/
 * languages.ts`, not the UI's eight locales): mono code chip · native name ·
 * English label · right-hand state.
 *
 *   Editing — this document                (fg-subtle)
 *   Open    — a sibling under the topic    (fg-subtle; navigates to it)
 *   Create  — no sibling yet               (accent; POSTs the linked copy)
 *
 * The footnote is the comp's (353). Opening a sibling is a navigation, so the
 * discard guard runs when the draft is dirty.
 */
import { ChevronDown, Languages } from 'lucide-react';
import { useState } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger, Spinner, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { InvoiceLanguageView } from '../api.js';
import { DOCUMENT_LANGUAGES, type InvoiceLang } from '../model/languages.js';

export type LanguageRowState = 'editing' | 'open' | 'create';

export interface LanguageRow {
  code: InvoiceLang;
  native: string;
  label: string;
  state: LanguageRowState;
  /** The sibling's id when one exists. */
  id: string | null;
}

/** The comp's `langs()` English labels (1185-1190), as messages. */
export function languageLabel(code: InvoiceLang): string {
  switch (code) {
    case 'en':
      return t('invoices:languages.en', 'English');
    case 'de':
      return t('invoices:languages.de', 'German');
    case 'fr':
      return t('invoices:languages.fr', 'French');
    case 'es':
      return t('invoices:languages.es', 'Spanish');
    case 'pt':
      return t('invoices:languages.pt', 'Portuguese');
    case 'ja':
      return t('invoices:languages.ja', 'Japanese');
  }
}

export function languageStateLabel(state: LanguageRowState): string {
  switch (state) {
    case 'editing':
      return t('invoices:languages.state.editing', 'Editing');
    case 'open':
      return t('invoices:languages.state.open', 'Open');
    case 'create':
      return t('invoices:languages.state.create', 'Create');
  }
}

/** The rows, in the comp's fixed language order (1620-1634). */
export function languageRows(current: InvoiceLang, languages: readonly InvoiceLanguageView[]): LanguageRow[] {
  return DOCUMENT_LANGUAGES.map((language) => {
    const isCurrent = language.code === current;
    const sibling = isCurrent ? undefined : languages.find((view) => view.lang === language.code);
    return {
      code: language.code,
      native: language.native,
      label: languageLabel(language.code),
      state: isCurrent ? 'editing' : sibling === undefined ? 'create' : 'open',
      id: sibling?.id ?? null,
    };
  });
}

export interface LanguageMenuProps {
  current: InvoiceLang;
  languages: readonly InvoiceLanguageView[];
  /** The language being created right now, for the row's spinner. */
  adding: InvoiceLang | null;
  onOpen: (id: string) => void;
  onCreate: (lang: InvoiceLang) => void;
}

export function LanguageMenu({ current, languages, adding, onOpen, onCreate }: LanguageMenuProps) {
  const [open, setOpen] = useState(false);
  const rows = languageRows(current, languages);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="md"
          data-testid="invoices-language-button"
          className="gap-[7px] rounded-[10px] px-[11px] text-[12px] font-bold text-fg-muted"
          iconLeft={<Languages className="size-[15px]" />}
          iconRight={<ChevronDown className="size-[13px]" />}
          title={t('invoices:languages.title', 'Language variations')}
        >
          {current.toUpperCase()}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[272px] max-w-[78vw] rounded-[14px] p-[7px]" data-testid="invoices-language-menu">
        <div className="px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[.06em] text-fg-subtle">
          {t('invoices:languages.title', 'Language variations')}
        </div>
        <ul className="m-0 list-none p-0">
          {rows.map((row) => {
            const isCurrent = row.state === 'editing';
            const busy = adding === row.code;
            return (
              <li key={row.code}>
                <button
                  type="button"
                  data-testid="invoices-language-row"
                  data-lang={row.code}
                  data-state={row.state}
                  aria-current={isCurrent ? 'true' : undefined}
                  disabled={adding !== null}
                  onClick={() => {
                    setOpen(false);
                    if (isCurrent) return;
                    if (row.id !== null) onOpen(row.id);
                    else onCreate(row.code);
                  }}
                  className={cn(
                    'nb-ib flex w-full items-center gap-[9px] rounded-[9px] px-2.5 py-2 text-start text-fg disabled:opacity-60',
                    isCurrent && 'bg-accent-soft text-accent hover:bg-accent-soft',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[9.5px] font-extrabold',
                      isCurrent ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-fg-muted',
                    )}
                  >
                    {row.code.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold">{row.native}</span>
                    <span className="block text-[10.5px] text-fg-subtle">{row.label}</span>
                  </span>
                  {busy ? (
                    <Spinner size="sm" className="ms-auto size-[15px]" />
                  ) : (
                    <span className={cn('ms-auto shrink-0 text-[10px] font-bold', row.state === 'create' ? 'text-accent' : 'text-fg-subtle')}>
                      {languageStateLabel(row.state)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-2.5 pb-1 pt-2 text-[10.5px] leading-[1.5] text-fg-subtle">
          {t('invoices:languages.footnote', 'Creating a language makes a linked copy, grouped under the same topic.')}
        </div>
      </PopoverContent>
    </Popover>
  );
}
