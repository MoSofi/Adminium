// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Icon picker — pick a lucide icon by looking at it, not by knowing its name.
 *
 * Page icons are stored as kebab-case lucide names (`layout-dashboard`) because
 * that is what the nav row carries and `lucideByName` resolves. A plain text
 * field therefore only works for someone who has the lucide catalogue
 * memorised; everyone else types a guess, gets the silent `File` fallback, and
 * has no way to tell whether the name was wrong or the icon just looks like
 * that.
 *
 * WHY THIS LIVES IN THE DASHBOARD, not `packages/ui`: it needs the whole
 * `icons` map to search, and `import { icons } from 'lucide-react'` defeats
 * tree-shaking for every consumer of the module that does it. The dashboard
 * already pays that cost in `lib/lucide.ts` (the sidebar resolves arbitrary
 * stored names), so searching the full catalogue here is free. Putting the same
 * import in `@adminium/ui` would push ~1,500 icon components into a chunk the
 * desktop app and every other consumer loads.
 *
 * The grid shows a curated shortlist rather than all of them: 1,500 buttons is
 * a scroll, not a choice. Search falls through to the full catalogue, so
 * nothing is unreachable — the shortlist is the fast path, not the limit.
 */

import { useMemo, useState } from 'react';
import { icons } from 'lucide-react';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  cn,
} from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';

/**
 * Icons that actually read as admin-app pages, grouped the way someone
 * choosing one thinks: what is this page FOR. Every entry is a real lucide
 * name — `lucideByName` falls back to `File` for a typo, which would make a
 * mistake here invisible, so this list is covered by a test.
 */
export const ICON_SHORTLIST: readonly string[] = [
  // data + records
  'table', 'table-2', 'database', 'list', 'rows-3', 'columns-3', 'file-text', 'files', 'folder',
  'archive', 'box', 'package', 'layers', 'grid-2x2', 'clipboard-list', 'book-open',
  // dashboards + analytics
  'layout-dashboard', 'chart-bar', 'chart-line', 'chart-pie', 'trending-up', 'activity', 'gauge',
  'target', 'sparkles', 'zap',
  // people
  'user', 'users', 'user-plus', 'user-check', 'contact', 'id-card', 'building', 'building-2',
  'briefcase', 'handshake',
  // commerce
  'shopping-cart', 'shopping-bag', 'credit-card', 'receipt', 'banknote', 'wallet', 'tag', 'tags',
  'percent', 'gift',
  // planning + time
  'calendar', 'calendar-days', 'calendar-clock', 'clock', 'timer', 'kanban', 'list-checks',
  'circle-check', 'flag', 'milestone',
  // comms + support
  'inbox', 'mail', 'message-square', 'bell', 'megaphone', 'life-buoy', 'phone', 'send',
  // ops + infra
  'settings', 'sliders-horizontal', 'server', 'cpu', 'hard-drive', 'cloud', 'terminal', 'wrench',
  'shield', 'lock', 'key', 'scroll-text', 'bug', 'git-branch',
  // logistics + places
  'truck', 'map', 'map-pin', 'globe', 'plane', 'ship', 'factory', 'warehouse', 'store', 'house',
  // media
  'image', 'video', 'music', 'camera', 'paperclip', 'link',
];

/** kebab-case → the PascalCase key the lucide `icons` map is keyed by. */
function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]?.toUpperCase() + part.slice(1)))
    .join('');
}

/** Every lucide name in kebab-case, computed once and shared by all pickers. */
let allNamesCache: string[] | null = null;
function allIconNames(): string[] {
  allNamesCache ??= Object.keys(icons)
    // `AArrowDown` → `a-arrow-down`; the boundary before a digit stays glued
    // (`Grid2x2`), matching how the stored names are written.
    .map((name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
    .sort();
  return allNamesCache;
}

export function isKnownIcon(name: string): boolean {
  return Object.hasOwn(icons, pascalCase(name));
}

/** Shortlist first, then the rest of the catalogue, de-duplicated. */
export function searchIcons(query: string, limit = 96): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...ICON_SHORTLIST].slice(0, limit);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pool of [ICON_SHORTLIST, allIconNames()]) {
    for (const name of pool) {
      if (out.length >= limit) return out;
      if (seen.has(name) || !name.includes(needle)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export interface IconPickerProps {
  /** Current kebab-case lucide name; empty string means "no icon chosen". */
  value: string;
  onChange: (name: string) => void;
  /** Accessible name for the trigger — the field label is not enough context. */
  label: string;
  testId?: string;
}

export function IconPicker({ value, onChange, label, testId }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchIcons(query), [query]);
  const Current = lucideByName(value === '' ? 'file' : value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reset on close so reopening starts from the shortlist rather than
        // whatever was searched for last time.
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="justify-start gap-2"
          aria-label={label}
          data-testid={testId}
        >
          <Current className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="truncate font-mono text-body-sm">
            {value === '' ? t('studioPages.icon.none', 'Choose an icon') : value}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3">
        <div className="flex flex-col gap-3">
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('studioPages.icon.search', 'Search icons')}
            aria-label={t('studioPages.icon.search', 'Search icons')}
            data-testid="studio-pages-icon-search"
          />
          {results.length === 0 ? (
            <p className="text-body-sm px-1 py-6 text-center text-fg-subtle">
              {t('studioPages.icon.noMatches', 'No icons match that search.')}
            </p>
          ) : (
            <div
              className="grid max-h-[240px] grid-cols-8 gap-1 overflow-y-auto"
              role="listbox"
              aria-label={label}
            >
              {results.map((name) => {
                const Glyph = lucideByName(name);
                const selected = name === value;
                return (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={name}
                    title={name}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md border border-transparent text-fg-muted',
                      'hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      selected && 'border-accent bg-accent-soft text-accent-fg',
                    )}
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                  >
                    <Glyph className="size-4" aria-hidden />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
