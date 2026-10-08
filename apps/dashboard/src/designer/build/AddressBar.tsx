// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The address of the page the preview is on: the side's key, a rule, and the
 * path, always written left to right. It fills what the work bar has left and
 * is never narrower than 180.
 *
 * It is a field a person can type a path into. Focus selects the whole path
 * and opens the pages known on that side; what is typed is bold inside each
 * path and the pages that match come first. Enter goes to exactly what was
 * typed, unless an arrow key picked a row. Escape, or leaving the field, puts
 * the real path back. Until the side has said where it is (an app whose
 * pages have no addresses yet never does) the field only shows.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { File } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent, Tooltip } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { isDesignerPath, shownPath, typedPagePath } from './pagePath.js';
import type { PreviewSide } from './usePreview.js';

export function addressLabel(side: PreviewSide): string {
  switch (side) {
    case 'dashboard':
      return t('designer:preview.addressDashboard', 'Address on the dashboard side');
    case 'staff':
      return t('designer:preview.addressStaff', 'Address on the staff side');
    case 'customer':
      return t('designer:preview.addressCustomer', 'Address on the customer side');
  }
}

/** A page the list offers: its path in the one shape, and what the page is called (nothing when it has no name). */
export interface KnownPage {
  path: string;
  name: string;
}

/** The longest path a row shows whole. */
const ROW_PATH_MAX = 44;

/** A long path with its middle cut out: the start says where, the end says which. */
export function cutMiddle(text: string, most: number = ROW_PATH_MAX): string {
  if (text.length <= most) return text;
  const keep = most - 1;
  return `${text.slice(0, Math.ceil(keep / 2))}…${text.slice(text.length - Math.floor(keep / 2))}`;
}

/** The pages in the order the list shows them: the ones that hold what was typed first, each group in its own order. */
export function offered(pages: readonly KnownPage[], typed: string): KnownPage[] {
  const query = typed.trim().toLowerCase();
  if (query === '') return [...pages];
  const holds = (page: KnownPage): boolean => shownPath(page.path).toLowerCase().includes(query);
  return [...pages.filter(holds), ...pages.filter((page) => !holds(page))];
}

const BOX = 'relative flex h-8 min-w-[180px] flex-[1_1_180px] items-center gap-[7px] rounded-[9px] border border-border bg-surface-2 px-2.5 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft';
const INPUT = 'h-full min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px font-mono text-[12.5px] font-medium text-fg outline-none read-only:cursor-default';

export function AddressBar({
  side,
  path,
  prefix = '',
  spoken = false,
  pages = [],
  listLabel,
  onGo,
  measuring = false,
}: {
  side: PreviewSide;
  path: string;
  /** Where the side is mounted: a whole address typed or pasted loses it. */
  prefix?: string;
  /** Whether the side has said where it is: only then can it be sent somewhere. */
  spoken?: boolean;
  pages?: readonly KnownPage[];
  /** What the list is: the pages on this side, or (a customer side) the pages opened so far. */
  listLabel?: string | undefined;
  onGo?: (path: string) => void;
  /** The copy that is only measured: a box with no name. */
  measuring?: boolean;
}): ReactNode {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  /** What is being typed; null while the field shows the real path. */
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** Whether an arrow key picked the active row: only then does Enter go to it. */
  const [picked, setPicked] = useState(false);
  const real = shownPath(path);
  const rows = offered(pages, draft ?? '');
  const at = Math.min(active, rows.length - 1);
  const query = (draft ?? '').trim().toLowerCase();

  const leave = (): void => {
    setOpen(false);
    setDraft(null);
    setPicked(false);
  };
  const go = (to: string | null): void => {
    leave();
    input.current?.blur();
    // No path at all, or the Designer inside its own preview: the field goes back to where the side really is.
    if (to === null || (side === 'dashboard' && isDesignerPath(to))) return;
    onGo?.(to);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!spoken) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setOpen(true);
      // The first arrow lands on the first row (or the last, going up); after that they move.
      setActive(picked ? (at + step + rows.length) % rows.length : step === 1 ? 0 : rows.length - 1);
      setPicked(true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = picked && open ? rows[at] : undefined;
      go(row === undefined ? typedPagePath(draft ?? real, prefix) : row.path);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      leave();
      input.current?.blur();
    }
  };

  const field = (
    <input
      ref={input}
      role="combobox"
      aria-label={measuring ? undefined : addressLabel(side)}
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-autocomplete="list"
      aria-activedescendant={open && picked && rows[at] !== undefined ? `${listId}-${String(at)}` : undefined}
      tabIndex={measuring ? -1 : undefined}
      readOnly={!spoken}
      value={draft ?? real}
      spellCheck={false}
      autoComplete="off"
      onFocus={(event) => {
        if (!spoken) return;
        const target = event.currentTarget;
        setDraft((now) => now ?? real);
        setOpen(true);
        setActive(0);
        setPicked(false);
        // After the browser has placed its caret: the whole path is selected, so typing replaces it.
        requestAnimationFrame(() => target.select());
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setOpen(true);
        setActive(0);
        setPicked(false);
      }}
      onKeyDown={onKey}
      onBlur={leave}
      className={INPUT}
    />
  );

  return (
    <Popover open={open && spoken} onOpenChange={(next) => (next ? undefined : leave())}>
      <PopoverAnchor asChild>
        <div dir="ltr" data-part="address" className={BOX}>
          {/* The side's own key, as an address has it: not a word to translate. */}
          <span className="shrink-0 font-mono text-[11px] font-semibold text-fg-subtle">{side}</span>
          <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border-strong" />
          {spoken || measuring ? field : <Tooltip content={t('designer:preview.addressQuiet', 'This app’s pages have no addresses yet. Ask the Designer to give each page its own address.')}>{field}</Tooltip>}
        </div>
      </PopoverAnchor>
      <PopoverContent
        dir="ltr"
        align="start"
        // The field keeps the keyboard: the list is read through it, never entered.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target === input.current) event.preventDefault();
        }}
        className="nb-scroll max-h-[320px] w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-[12px] p-[5px] leading-[normal]"
      >
        <div id={listId} role="listbox" aria-label={listLabel ?? t('designer:preview.pages', 'Pages on this side')}>
          {rows.map((page, index) => {
            const shown = cutMiddle(shownPath(page.path));
            const found = query === '' ? -1 : shown.toLowerCase().indexOf(query);
            return (
              <div
                key={page.path}
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={picked && index === at}
                // Before the field loses the keyboard: a row is picked, not focused.
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(page.path);
                }}
                className={`flex cursor-pointer items-center gap-[9px] rounded-[8px] px-2.5 py-[7px] hover:bg-surface-2 ${picked && index === at ? 'bg-surface-3' : ''}`}
              >
                <File aria-hidden="true" className="size-[13px] shrink-0 text-fg-subtle" />
                <span className="whitespace-nowrap font-mono text-[12.5px] text-fg-muted">
                  {found < 0 ? (
                    shown
                  ) : (
                    <>
                      {shown.slice(0, found)}
                      <span className="font-bold text-fg">{shown.slice(found, found + query.length)}</span>
                      {shown.slice(found + query.length)}
                    </>
                  )}
                </span>
                {page.name === '' ? null : <span className="ms-auto min-w-0 truncate ps-2 text-[12px] font-semibold text-fg-subtle">{page.name}</span>}
              </div>
            );
          })}
        </div>
        <div className="px-2.5 pb-[3px] pt-1.5 text-[11px] text-fg-subtle">
          {(() => {
            const [before, after] = t('designer:preview.addressEnter', 'Press {key} to go to what you typed.', { key: '\u0001' }).split('\u0001');
            return (
              <>
                {before}
                <span className="font-mono">Enter</span>
                {after}
              </>
            );
          })()}
        </div>
      </PopoverContent>
    </Popover>
  );
}
