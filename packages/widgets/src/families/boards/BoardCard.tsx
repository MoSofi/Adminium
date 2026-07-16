import { Avatar, EmptyState, MonoText, ProgressBar, Tag } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { GripVertical } from 'lucide-react';

import { boardCardConfigSchema, boardCardDemoData } from './boards-config.js';
import { boardToneOf, ownerInitials, priorityTone, toBoardCard } from './board-lib.js';
import type { BoardCardConfig } from './boards-config.js';
import type { BoardCardData } from './board-lib.js';
import type { WidgetProps } from '../../registry/types.js';

export { boardCardConfigSchema, boardCardDemoData };
export type { BoardCardConfig };

/**
 * `board-card` presentational body (annex §6) — the draggable card's contents:
 * a tone/lane-tinted tag pill, a grip affordance, the bold title, optional
 * client/points/priority rows, a percent label + column-toned progress bar, a
 * gradient-initials owner avatar, a due chip, and the mono card id. Purely
 * presentational: dragging/keyboard live in the shell (`DraggableCard`), so this
 * renders identically in a story, a test, or under a live DndContext.
 *
 * It is ALSO a registry widget in its own right (`BoardCardWidget` below): the
 * annex gives `board-card` its own id, and the surfaces that show exactly one
 * card against a single `record` — a linked card in a timeline, the builder
 * palette's preview — instantiate it directly. Same component either way, so a
 * card is pixel-identical wherever it appears.
 */

export interface BoardCardProps {
  card: BoardCardData;
  /** Progress-bar + accent tone, normally the card's column tone. */
  columnTone?: Tone | undefined;
  locale?: string | undefined;
  /** Label for the drag grip (localized at the host boundary). */
  gripLabel?: string | undefined;
  pointsUnit?: string | undefined;
  /**
   * Show the drag grip. True inside a board (the card IS draggable); false for a
   * standalone `board-card` instance, where a grip would advertise an affordance
   * that does nothing.
   */
  showGrip?: boolean | undefined;
}

export function BoardCard({
  card,
  columnTone = 'accent',
  locale,
  gripLabel,
  pointsUnit,
  showGrip = true,
}: BoardCardProps) {
  const initials = ownerInitials(card.owner, locale);
  const hasPct = typeof card.pct === 'number';
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-3 shadow-sm">
      <div className="flex items-start gap-2">
        {card.tag !== undefined && (
          <Tag tone={boardToneOf(card.tagTone, columnTone)}>{card.tag}</Tag>
        )}
        {card.priority !== undefined && (
          <Tag tone={priorityTone(card.priority)} className="uppercase">
            {card.priority}
          </Tag>
        )}
        {card.points !== undefined && (
          <MonoText className="ms-auto text-caption font-semibold text-fg-muted">
            {card.points}
            {pointsUnit === undefined ? '' : ` ${pointsUnit}`}
          </MonoText>
        )}
        {showGrip && (
          <span
            aria-hidden="true"
            data-part="board-card-grip"
            title={gripLabel}
            className={
              (card.points === undefined ? 'ms-auto ' : '') +
              'shrink-0 cursor-grab text-fg-subtle'
            }
          >
            <GripVertical className="size-4" />
          </span>
        )}
      </div>

      <p className="text-body-sm font-semibold leading-snug text-fg">{card.title}</p>

      {(card.client !== undefined || card.budget !== undefined) && (
        <div className="flex items-center justify-between gap-2 text-caption text-fg-muted">
          {card.client !== undefined && <span className="truncate">{card.client}</span>}
          {card.budget !== undefined && <MonoText className="shrink-0">{card.budget}</MonoText>}
        </div>
      )}

      {hasPct && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-end text-caption text-fg-muted">
            <MonoText className="font-semibold text-fg">{`${Math.round(card.pct ?? 0)}%`}</MonoText>
          </div>
          <ProgressBar value={card.pct ?? 0} tone={columnTone} animated={false} label={card.title} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-2">
          {initials !== undefined && (
            <Avatar size="xs" name={card.owner ?? ''} {...(locale === undefined ? {} : { locale })} />
          )}
          {card.due !== undefined && (
            <MonoText className="rounded-sm bg-surface-3 px-1.5 py-0.5 text-[10px] text-fg-muted">{card.due}</MonoText>
          )}
        </div>
        <MonoText className="text-[10px] text-fg-subtle">{card.id}</MonoText>
      </div>
    </div>
  );
}

/** The optional slots a `board-card` config may hide (annex "visible fields"). */
type BoardCardField = NonNullable<BoardCardConfig['fields']>[number];

/**
 * Project a single `record` payload onto a `BoardCardData`, honouring the
 * config's visible-field allow-list. Hiding a field DROPS it from the data
 * rather than adding a render flag per slot: `BoardCard` already renders each
 * slot only when its value is defined, so the allow-list and the "no value"
 * case collapse to one code path — and the presentational component stays
 * exactly what the kanban columns render.
 */
export function boardCardOf(data: unknown, config: BoardCardConfig): BoardCardData | null {
  const row = (typeof data === 'object' && data !== null ? (data as { row?: unknown; data?: unknown }).row ?? (data as { data?: unknown }).data : undefined);
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const card = toBoardCard(row as Record<string, unknown>, 0, {
    columnField: 'status',
    titleField: config.titleField,
  });
  const fields = config.fields;
  if (fields === undefined) return card;
  const visible = new Set<BoardCardField>(fields);
  const keep = <T,>(field: BoardCardField, value: T): T | undefined => (visible.has(field) ? value : undefined);
  return {
    ...card,
    id: visible.has('id') ? card.id : '',
    tag: keep('tag', card.tag),
    priority: keep('priority', card.priority),
    points: keep('points', card.points),
    client: keep('client', card.client),
    budget: keep('budget', card.budget),
    pct: keep('pct', card.pct),
    owner: keep('owner', card.owner),
    due: keep('due', card.due),
  };
}

export function BoardCardWidget({ config, data, onEvent }: WidgetProps<BoardCardConfig>) {
  const card = boardCardOf(data, config);
  if (card === null) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={config.emptyState?.titleKey ?? 'No card'}
        body={config.emptyState?.bodyKey ?? 'This card has no record bound to it yet.'}
      />
    );
  }
  const href = config.linkTarget ?? config.href;
  const body = (
    <BoardCard
      card={card}
      showGrip={false}
      columnTone={boardToneOf(config.columnTone, 'accent')}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.gripLabel === undefined ? {} : { gripLabel: config.gripLabel })}
      {...(config.pointsUnit === undefined ? {} : { pointsUnit: config.pointsUnit })}
    />
  );
  if (href === undefined) return <div data-widget="board-card">{body}</div>;
  return (
    <button
      type="button"
      data-widget="board-card"
      onClick={() => onEvent({ type: 'drill-through', href })}
      className="block w-full text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {body}
    </button>
  );
}
