// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The header's language button and its menu (comp 467-478, 1543-1557;
 * Appendix A §E1; D3): *{native} N ▾* opens *Language variations* — one row
 * per locale the workspace offers (`availableLocales()`, not the comp's six):
 * code chip · native name · status line · action glyph.
 *
 *   Editing now       — this variation                 (check, accent)
 *   Translated        — a sibling with its own copy    (pencil → opens it)
 *   Needs translation — a verbatim sibling             (pencil → opens it)
 *   Not created yet   — no sibling                     (plus → Add)
 *
 * Opening a sibling is a navigation, so the D1 guard runs when the draft is
 * dirty. *Add* asks the server for the linked copy (a starter family gets the
 * starter in that language; otherwise a verbatim copy flagged for
 * translation) and opens the reply; a 409 with `existingId` means the row
 * appeared meanwhile (or is archived) — the client opens it instead.
 */
import { Check, ChevronDown, Languages, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { availableLocales } from '@adminium/i18n';
import { Button, Popover, PopoverContent, PopoverTrigger, Spinner, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { EmailLanguageView } from '../api.js';
import { localeFacts, localeOrder } from '../manager/model.js';

export type LanguageRowStatus = 'current' | 'translated' | 'needsTranslation' | 'missing';

export interface LanguageRow {
  locale: string;
  code: string;
  native: string;
  english: string;
  status: LanguageRowStatus;
  /** The sibling's id when one exists (live). */
  id: string | null;
}

/** The rows, in registry order; archived siblings read as *Not created yet* (D3). */
export function languageRows(currentLocale: string, languages: readonly EmailLanguageView[]): LanguageRow[] {
  const ids = [...new Set([...availableLocales().map((l) => l.id), ...languages.map((l) => l.locale), currentLocale])];
  ids.sort((a, b) => localeOrder(a) - localeOrder(b) || a.localeCompare(b));
  return ids.map((locale) => {
    const facts = localeFacts(locale, ids);
    const sibling = languages.find((l) => l.locale === locale && !l.archived);
    const status: LanguageRowStatus =
      locale === currentLocale ? 'current' : sibling === undefined ? 'missing' : sibling.needsTranslation ? 'needsTranslation' : 'translated';
    return { locale, code: facts.code, native: facts.native, english: facts.english, status, id: sibling?.id ?? null };
  });
}

export function statusLine(status: LanguageRowStatus): string {
  switch (status) {
    case 'current':
      return t('email:editor.languages.current', 'Editing now');
    case 'translated':
      return t('email:editor.languages.translated', 'Translated');
    case 'needsTranslation':
      return t('email:editor.languages.needsTranslation', 'Needs translation');
    case 'missing':
      return t('email:editor.languages.missing', 'Not created yet');
  }
}

export interface LanguageMenuProps {
  currentLocale: string;
  languages: readonly EmailLanguageView[];
  /** The locale being created right now, for the row's spinner. */
  adding: string | null;
  onOpen: (id: string) => void;
  onAdd: (locale: string) => void;
}

export function LanguageMenu({ currentLocale, languages, adding, onOpen, onAdd }: LanguageMenuProps) {
  const [open, setOpen] = useState(false);
  const rows = languageRows(currentLocale, languages);
  const current = rows.find((row) => row.status === 'current');
  const liveCount = languages.filter((l) => !l.archived).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="md"
          data-testid="email-language-button"
          iconLeft={<Languages className="text-fg-muted" />}
          iconRight={<ChevronDown className="text-fg-subtle" />}
          title={t('email:editor.languages.title', 'Language variations')}
        >
          {current?.native ?? currentLocale}
          <span className="rounded-[20px] bg-surface-3 px-1.5 py-px text-[10px] font-extrabold text-fg-subtle">{liveCount}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[278px] max-w-[78vw] rounded-[14px] p-[7px]" data-testid="email-language-menu">
        <div className="px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[.06em] text-fg-subtle">
          {t('email:editor.languages.title', 'Language variations')}
        </div>
        <ul className="m-0 list-none p-0">
          {rows.map((row) => {
            const isCurrent = row.status === 'current';
            const exists = row.id !== null;
            const busy = adding === row.locale;
            return (
              <li key={row.locale}>
                <button
                  type="button"
                  data-testid="email-language-row"
                  data-locale={row.locale}
                  data-status={row.status}
                  aria-current={isCurrent ? 'true' : undefined}
                  disabled={busy || adding !== null}
                  onClick={() => {
                    if (isCurrent) {
                      setOpen(false);
                      return;
                    }
                    setOpen(false);
                    if (row.id !== null) onOpen(row.id);
                    else onAdd(row.locale);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[9px] px-[9px] py-[7px] text-start text-fg transition-colors hover:bg-surface-2 disabled:opacity-60',
                    isCurrent && 'bg-accent-soft hover:bg-accent-soft',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex min-w-8 shrink-0 items-center justify-center rounded-md border px-1.5 py-[3px] text-[10px] font-extrabold tracking-[.04em]',
                      isCurrent
                        ? 'border-transparent bg-accent text-accent-fg'
                        : exists
                          ? 'border-transparent bg-surface-3 text-fg-muted'
                          : 'border-dashed border-border-strong bg-transparent text-fg-muted',
                    )}
                  >
                    {row.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold">{row.native}</span>
                    <span className="block text-[10.5px] text-fg-muted">{statusLine(row.status)}</span>
                  </span>
                  {busy ? (
                    <Spinner size="sm" className="size-[15px]" />
                  ) : isCurrent ? (
                    <Check className="size-[15px] shrink-0 text-accent" aria-hidden="true" />
                  ) : exists ? (
                    <Pencil className="size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
                  ) : (
                    <Plus className="size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
