import { useMaybeT } from '@adminium/i18n/react';
import { Avatar, Button, EmptyState, IconTile, StatusPill } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { FileText, LayoutGrid } from 'lucide-react';

import type { CardGalleryConfig, CardThumbnailMode } from './tables-track-f-config.js';
import type { GalleryCard } from './tables-track-f-types.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `card-gallery` (annex §3) — a responsive card grid for entities: an
 * icon/monogram/doc-preview thumbnail, name, status pill, a meta line, and a
 * hover-reveal action bar. Powers template/integration/member/file galleries.
 * Binds to a `record-list` + a card mapping.
 */

// Config schema + deterministic demo payload live in the pure
// `tables-track-f-config` module, and the card shape in
// `tables-track-f-types`, so the registry metadata graph never reaches this
// component file (04 §2.3). Re-exported here to keep existing import points
// stable.
export { cardGalleryConfigSchema, cardGalleryDemoData } from './tables-track-f-config.js';
export type { CardGalleryConfig } from './tables-track-f-config.js';
export type { GalleryCard } from './tables-track-f-types.js';

const COLUMN_CLASS: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

export interface CardGalleryProps {
  cards: readonly GalleryCard[];
  columns?: number | undefined;
  thumbnail?: CardThumbnailMode;
  actions?: { key: string; label: string }[] | undefined;
  clickable?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onOpen?: ((card: GalleryCard) => void) | undefined;
  onAction?: ((key: string, card: GalleryCard) => void) | undefined;
  testId?: string | undefined;
}

function Thumbnail({ card, mode }: { card: GalleryCard; mode: CardThumbnailMode }) {
  const tone = (card.tone as Tone | undefined) ?? 'accent';
  if (mode === 'none') return null;
  if (mode === 'monogram') return <Avatar name={card.title} size="lg" shape="square" />;
  if (mode === 'icon') return <IconTile size="lg" tone={tone} icon={<LayoutGrid />} />;
  // doc-preview: a generated miniature document skeleton with the real title.
  return (
    <div aria-hidden="true" className="flex h-16 w-full flex-col gap-1 rounded-md border border-border bg-surface-2 p-2">
      <div className="flex items-center gap-1.5">
        <FileText className="size-3 text-fg-subtle" />
        <div className="h-1.5 w-1/2 rounded-full bg-fg-subtle/40" />
      </div>
      <div className="h-1 w-full rounded-full bg-fg-subtle/20" />
      <div className="h-1 w-5/6 rounded-full bg-fg-subtle/20" />
      <div className="h-1 w-2/3 rounded-full bg-fg-subtle/20" />
    </div>
  );
}

export function CardGallery({
  cards,
  columns = 3,
  thumbnail = 'monogram',
  actions,
  clickable = true,
  emptyTitle,
  emptyBody,
  onOpen,
  onAction,
  testId,
}: CardGalleryProps) {
  const t = useMaybeT();
  if (cards.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.tables.cardGallery.emptyTitle', 'Nothing to show')}
        body={emptyBody ?? t('ui:widgets.tables.cardGallery.emptyBody', 'Items will appear here as cards.')}
      />
    );
  }
  return (
    <div data-widget="card-gallery" data-testid={testId} className="h-full overflow-y-auto p-3">
      <ul className={`grid gap-3 ${COLUMN_CLASS[columns] ?? COLUMN_CLASS[3]}`}>
        {cards.map((card) => {
          const inner = (
            <>
              <div className="flex items-start justify-between gap-2">
                <Thumbnail card={card} mode={thumbnail} />
                {card.status !== undefined && (
                  <StatusPill status={card.status} {...(card.statusTone === undefined ? {} : { tone: card.statusTone as Tone })} />
                )}
              </div>
              <div className="mt-3 min-w-0">
                <p className="truncate text-body-sm font-semibold text-fg">{card.title}</p>
                {card.subtitle !== undefined && <p className="truncate text-caption text-fg-muted">{card.subtitle}</p>}
                {card.meta !== undefined && <p className="mt-0.5 truncate text-caption text-fg-subtle">{card.meta}</p>}
              </div>
              {actions !== undefined && actions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100">
                  {actions.map((action) => (
                    <Button
                      key={action.key}
                      size="sm"
                      variant="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAction?.(action.key, card);
                      }}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
            </>
          );
          return (
            <li key={card.id}>
              {clickable ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen?.(card)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpen?.(card);
                    }
                  }}
                  className="group/card flex h-full cursor-pointer flex-col rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-2/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {inner}
                </div>
              ) : (
                <div className="group/card flex h-full flex-col rounded-lg border border-border bg-surface p-3">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function cardsOf(data: unknown): GalleryCard[] {
  const raw = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  return raw.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      id: (row['id'] as string | number | undefined) ?? index,
      title: typeof row['title'] === 'string' ? row['title'] : typeof row['name'] === 'string' ? (row['name'] as string) : String(row['title'] ?? ''),
      subtitle: typeof row['subtitle'] === 'string' ? row['subtitle'] : typeof row['category'] === 'string' ? (row['category'] as string) : undefined,
      meta: typeof row['meta'] === 'string' ? row['meta'] : undefined,
      status: typeof row['status'] === 'string' ? row['status'] : undefined,
      statusTone: typeof row['statusTone'] === 'string' ? row['statusTone'] : undefined,
      tone: typeof row['tone'] === 'string' ? row['tone'] : undefined,
    };
  });
}

export function CardGalleryWidget({ config, data, onEvent }: WidgetProps<CardGalleryConfig>) {
  const source = config.binding;
  const table = source === undefined ? undefined : source.source.schema === undefined ? source.source.name : `${source.source.schema}.${source.source.name}`;
  return (
    <CardGallery
      cards={cardsOf(data)}
      columns={config.columns}
      thumbnail={config.thumbnail}
      actions={config.actions}
      clickable={config.clickAction !== 'none'}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      onOpen={(card) => {
        if (config.clickAction === 'link' && config.href !== undefined) {
          onEvent({ type: 'drill-through', href: config.href });
        } else if (table !== undefined && source !== undefined) {
          onEvent({ type: 'record-open', connectionId: source.connectionId, table, recordId: card.id });
        }
      }}
    />
  );
}

