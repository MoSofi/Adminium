import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, Search, SearchX } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { IconTile } from '../icon-tile/IconTile.js';
import { Kbd } from '../kbd/Kbd.js';

export interface CommandItem {
  /** Unique across all groups (used for selection + DOM ids). */
  id: string;
  label: string;
  /** Muted single-line subtitle under the label (e.g. a record hit's row context). */
  description?: string | undefined;
  /** Lucide icon element rendered in a small tile. */
  icon?: ReactNode;
  /** Keyboard hint rendered as `Kbd` at the row end (e.g. "G D"). */
  hint?: string;
  /** Extra strings matched by the default filter. */
  keywords?: readonly string[] | undefined;
  disabled?: boolean | undefined;
}

export interface CommandGroup {
  id: string;
  /** Uppercase section label ("Navigation", "Actions"). */
  label: string;
  items: readonly CommandItem[];
}

export interface CommandPaletteLabels {
  /** Sr-only dialog title (e.g. "Command palette"). */
  dialog: string;
  /** Search input placeholder + accessible name. */
  placeholder: string;
  /** Footer hint next to ↑↓. */
  navigate: string;
  /** Footer hint next to ↵. */
  open: string;
  /** Footer hint next to esc. */
  close: string;
  /** Empty-state copy; receives the query to echo it back. */
  empty: (query: string) => ReactNode;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Grouped items — the palette does no data fetching. */
  groups: readonly CommandGroup[];
  /** Invoked on Enter or click; the palette closes unless `closeOnSelect` is false. */
  onSelect: (item: CommandItem) => void;
  labels: CommandPaletteLabels;
  /** Controlled query (optional — internal state by default). */
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  /** Case-insensitive substring over label+keywords by default. */
  filter?: ((item: CommandItem, query: string) => boolean) | undefined;
  closeOnSelect?: boolean | undefined;
  /** Extra footer content (e.g. the "Ask AI" slot). */
  footerExtra?: ReactNode;
  className?: string | undefined;
}

const defaultFilter = (item: CommandItem, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (item.label.toLowerCase().includes(q)) return true;
  return (item.keywords ?? []).some((k) => k.toLowerCase().includes(q));
};

/**
 * CommandPalette — ⌘K dialog shell: search header, grouped results (icon tile
 * + label + kbd hint), accent-soft selected row, empty state echoing the
 * query, footer hint bar; fully keyboard driven (↑↓ wrap, Enter opens, Esc
 * closes) with `aria-activedescendant` combobox semantics
 * (research/design-system.md §3 Tier 3). Pair with `useCommandK`.
 */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  onSelect,
  labels,
  query: controlledQuery,
  onQueryChange,
  filter = defaultFilter,
  closeOnSelect = true,
  footerExtra,
  className,
}: CommandPaletteProps) {
  const listId = useId();
  const [internalQuery, setInternalQuery] = useState('');
  const query = controlledQuery ?? internalQuery;
  const setQuery = (next: string) => {
    setInternalQuery(next);
    onQueryChange?.(next);
  };

  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, items: group.items.filter((item) => filter(item, query)) }))
        .filter((group) => group.items.length > 0),
    [groups, filter, query],
  );
  const flatItems = useMemo(() => filteredGroups.flatMap((g) => g.items), [filteredGroups]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = flatItems.findIndex((item) => item.id === activeId);
  const active = activeIndex === -1 ? null : flatItems[activeIndex];

  // Reset query + selection when opening; keep selection valid as results change.
  useEffect(() => {
    if (open) setInternalQuery('');
  }, [open]);
  useEffect(() => {
    if (active === null || active === undefined) setActiveId(flatItems[0]?.id ?? null);
  }, [flatItems, active]);

  const listRef = useRef<HTMLDivElement>(null);
  const move = (delta: number) => {
    if (flatItems.length === 0) return;
    const next = (activeIndex + delta + flatItems.length) % flatItems.length;
    const item = flatItems[next] as CommandItem;
    setActiveId(item.id);
    document.getElementById(optionDomId(item))?.scrollIntoView?.({ block: 'nearest' });
  };

  const select = (item: CommandItem) => {
    if (item.disabled) return;
    onSelect(item);
    if (closeOnSelect) onOpenChange(false);
  };

  const optionDomId = (item: CommandItem) => `${listId}-${item.id}`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[3px] animate-[nb-fade_.2s_cubic-bezier(.2,.7,.3,1)]"
        />
        <DialogPrimitive.Content
          aria-label={labels.dialog}
          aria-describedby={undefined}
          className={cn(
            'fixed inset-x-0 top-[16vh] z-50 mx-auto flex max-h-[60vh] w-[560px] max-w-[calc(100vw-32px)] flex-col',
            'overflow-hidden rounded-lg border border-border bg-surface shadow-modal outline-none',
            'animate-[nb-pop_.16s_cubic-bezier(.2,.7,.3,1)]',
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{labels.dialog}</DialogPrimitive.Title>
          {/* Search header */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <input
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={active ? optionDomId(active) : undefined}
              aria-label={labels.placeholder}
              placeholder={labels.placeholder}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (active) select(active);
                } else if (event.key === 'Home' && flatItems.length > 0) {
                  event.preventDefault();
                  setActiveId((flatItems[0] as CommandItem).id);
                } else if (event.key === 'End' && flatItems.length > 0) {
                  event.preventDefault();
                  setActiveId((flatItems[flatItems.length - 1] as CommandItem).id);
                }
              }}
              className="h-12 w-full bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle"
            />
            <Kbd>esc</Kbd>
          </div>

          {/* Results */}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={labels.dialog}
            className="nb-scroll min-h-0 flex-1 overflow-y-auto p-2"
          >
            {flatItems.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <IconTile size="lg" tone="neutral" icon={<SearchX />} />
                <div className="text-body-sm text-fg-muted">{labels.empty(query)}</div>
              </div>
            ) : (
              filteredGroups.map((group) => (
                <div key={group.id} role="group" aria-label={group.label} className="mb-1 last:mb-0">
                  <div className="px-2.5 pb-1 pt-2 text-micro uppercase text-fg-subtle">{group.label}</div>
                  {group.items.map((item) => {
                    const isActive = item.id === activeId;
                    return (
                      <div
                        key={item.id}
                        id={optionDomId(item)}
                        data-item-id={item.id}
                        role="option"
                        aria-selected={isActive}
                        aria-disabled={item.disabled || undefined}
                        onMouseMove={() => setActiveId(item.id)}
                        onClick={() => select(item)}
                        className={cn(
                          'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2',
                          isActive ? 'bg-accent-soft' : undefined,
                          item.disabled ? 'cursor-default opacity-40' : undefined,
                        )}
                      >
                        {item.icon === undefined || item.icon === null ? null : (
                          <IconTile size="sm" tone={isActive ? 'accent' : 'neutral'} icon={item.icon} />
                        )}
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-body font-semibold',
                              isActive ? 'text-accent' : 'text-fg',
                            )}
                          >
                            {item.label}
                          </span>
                          {item.description === undefined ? null : (
                            <span className="block truncate text-caption text-fg-muted">
                              {item.description}
                            </span>
                          )}
                        </span>
                        {item.hint === undefined ? null : <Kbd>{item.hint}</Kbd>}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer hint bar */}
          <div className="flex shrink-0 items-center gap-4 border-t border-border bg-surface-2 px-4 py-2.5 text-caption text-fg-muted">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              {labels.navigate}
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>
                <CornerDownLeft className="size-3" aria-hidden="true" />
              </Kbd>
              {labels.open}
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              {labels.close}
            </span>
            {footerExtra === undefined ? null : <span className="ms-auto">{footerExtra}</span>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
