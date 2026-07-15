import { Avatar, MonoText, ProgressBar, Tag } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { GripVertical } from 'lucide-react';

import { boardToneOf, ownerInitials, priorityTone } from './board-lib.js';
import type { BoardCardData } from './board-lib.js';

/**
 * `board-card` presentational body (annex §6) — the draggable card's contents:
 * a tone/lane-tinted tag pill, a grip affordance, the bold title, optional
 * client/points/priority rows, a percent label + column-toned progress bar, a
 * gradient-initials owner avatar, a due chip, and the mono card id. Purely
 * presentational: dragging/keyboard live in the shell (`DraggableCard`), so this
 * renders identically in a story, a test, or under a live DndContext.
 */

export interface BoardCardProps {
  card: BoardCardData;
  /** Progress-bar + accent tone, normally the card's column tone. */
  columnTone?: Tone | undefined;
  locale?: string | undefined;
  /** Label for the drag grip (localized at the host boundary). */
  gripLabel?: string | undefined;
  pointsUnit?: string | undefined;
}

export function BoardCard({ card, columnTone = 'accent', locale, gripLabel, pointsUnit }: BoardCardProps) {
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
