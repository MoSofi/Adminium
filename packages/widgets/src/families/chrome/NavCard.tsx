/**
 * `nav-card` (annex §11) — clickable surface card: tinted icon tile, title,
 * 2-line description, hover lift + sliding arrow; for hub/landing pages inside
 * the admin. Evidence: Home.
 *
 * Renders a GRID of cards from one `record-list` (the annex's contract is a
 * `{name, desc, icon, href, tint}` LIST, and `columns` is its config), so one
 * widget instance is the whole hub grid rather than one card per instance.
 */

import { EmptyState, IconTile, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { ArrowRight } from 'lucide-react';
import type { MouseEvent } from 'react';

import { chromeIcon } from './chrome-icons.js';
import { isSafeHref, oneOf, recordRowsOf, stringField } from './chrome-lib.js';
import { navCardConfigSchema, navCardDemoData } from './chrome-config.js';
import type { NavCardConfig } from './chrome-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { navCardConfigSchema, navCardDemoData };
export type { NavCardConfig };

const TINTS = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;
type Tint = (typeof TINTS)[number];

export interface NavCardItem {
  key: string;
  name: string;
  desc?: string | undefined;
  icon?: string | undefined;
  href?: string | undefined;
  tint: Tint;
}

/** Project the §3 `record-list` payload onto hub cards. */
export function navCardsOf(data: unknown, config: NavCardConfig): NavCardItem[] {
  const rows = recordRowsOf(data);
  const out: NavCardItem[] = [];
  for (const [index, row] of rows.entries()) {
    const name = stringField(row, config.nameField);
    if (name === undefined) continue;
    const href = stringField(row, config.hrefField);
    out.push({
      key: `${name}-${index}`,
      name,
      desc: stringField(row, config.descField),
      icon: stringField(row, config.iconField),
      ...(isSafeHref(href) ? { href } : {}),
      tint: oneOf(row[config.tintField], TINTS, 'accent'),
    });
  }
  return out;
}

/**
 * Explicit column classes — Tailwind scans source statically, so a computed
 * `grid-cols-${n}` would emit no CSS. Keyed by the schema's 1–4 range.
 */
const COLUMN_CLASSES: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

export interface NavCardViewProps {
  items: readonly NavCardItem[];
  columns?: number | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onNavigate?: ((href: string) => void) | undefined;
  testId?: string | undefined;
}

export function NavCardView({ items, columns = 3, emptyTitle, emptyBody, onNavigate, testId }: NavCardViewProps) {
  const t = useMaybeT();
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.chrome.navCard.emptyTitle', 'Nothing to show')}
        body={emptyBody ?? t('ui:widgets.chrome.navCard.emptyBody', 'Hub links appear here once pages are generated.')}
      />
    );
  }

  const click = (event: MouseEvent<HTMLAnchorElement>, href: string | undefined) => {
    if (href === undefined || onNavigate === undefined) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(href);
  };

  return (
    <div
      data-widget="nav-card"
      data-testid={testId}
      className={cn('grid h-full gap-3 overflow-auto px-4 pb-4', COLUMN_CLASSES[columns] ?? COLUMN_CLASSES[3])}
    >
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href ?? '#'}
          data-part="nav-card-item"
          data-tint={item.tint}
          onClick={(event) => click(event, item.href)}
          className={cn(
            'group flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5 no-underline',
            'transition-[transform,border-color,box-shadow] duration-150',
            'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <IconTile size="md" tone={item.tint} icon={chromeIcon(item.icon)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-bold text-fg">{item.name}</p>
            {item.desc !== undefined && (
              // 2-line clamp per the annex; the card is a teaser, not the page.
              <p className="line-clamp-2 text-caption text-fg-muted">{item.desc}</p>
            )}
          </div>
          {/*
            The sliding arrow is decoration, and it slides toward the READING
            direction: `translate-x` would point the wrong way in RTL, so the
            motion uses the logical `ms-` inset instead.
          */}
          <ArrowRight
            aria-hidden="true"
            className="ms-0 size-4 shrink-0 text-fg-subtle transition-[margin] duration-150 group-hover:ms-1 rtl:rotate-180"
          />
        </a>
      ))}
    </div>
  );
}

export function NavCardWidget({ config, data, onEvent }: WidgetProps<NavCardConfig>) {
  return (
    <NavCardView
      items={navCardsOf(data, config)}
      columns={config.columns}
      emptyTitle={config.emptyTitle}
      emptyBody={config.emptyBody}
      onNavigate={(href) => onEvent({ type: 'drill-through', href })}
      testId={config.testId}
    />
  );
}
