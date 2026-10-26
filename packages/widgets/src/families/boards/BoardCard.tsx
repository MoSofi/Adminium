// SPDX-License-Identifier: AGPL-3.0-only
import { Avatar, EmptyState, MonoText, Tag } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { useMaybeT } from '../../lib/i18n.js';
import { Calendar, GripVertical, User } from 'lucide-react';

import { boardCardConfigSchema, boardCardDemoData } from './boards-config.js';
import { boardToneOf, ownerInitials, priorityTone, toBoardCard } from './board-lib.js';
import type { BoardCardConfig } from './boards-config.js';
import type { BoardCardData } from './board-lib.js';
import type { WidgetProps } from '../../registry/types.js';

export { boardCardConfigSchema, boardCardDemoData };
export type { BoardCardConfig };

/**
 * `board-card` presentational body (annex) — the draggable card's contents: a
 * tone/lane-tinted tag pill, a grip affordance, the bold title, optional
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
  /**
   * Leaves the far end of the card's first line free: the board draws the
   * card's "more" button over that corner, and the grip stands before it.
   */
  actionsSpace?: boolean | undefined;
  /** The swimlane comp's smaller card: tag and points, the title, the owner and the card's id. */
  compact?: boolean | undefined;
  /** The Kanban Roadmap comp's card: its theme and the grip, the title, then progress beside the owner, the bar in the theme's colour. */
  roadmap?: boolean | undefined;
}

/** The progress bar's fill, by its column's tone: the comp's Planning grey, In Progress accent, On Hold amber, Completed green. */
const BAR_TONE: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** A priority's pill: the comp's rounded chip; its tone is the column's own where it has one, else read from the word. */
function PriorityPill({ card }: { card: BoardCardData }) {
  if (card.priority === undefined) return null;
  return (
    <Tag data-part="board-card-priority" tone={card.priorityTone ?? priorityTone(card.priority)} className="rounded-full px-2 py-[2px]">
      {card.priority}
    </Tag>
  );
}

export function BoardCard({
  card,
  columnTone = 'accent',
  locale,
  gripLabel,
  pointsUnit,
  showGrip = true,
  actionsSpace = false,
  compact = false,
  roadmap = false,
}: BoardCardProps) {
  const t = useMaybeT();
  const grip = gripLabel ?? t('ui:widgets.boards.grip', 'Drag to move card');
  const initials = ownerInitials(card.owner, locale);
  const hasPct = typeof card.pct === 'number';
  const pct = Math.max(0, Math.min(100, Math.round(card.pct ?? 0)));
  const gripMark = showGrip ? (
    <span aria-hidden="true" data-part="board-card-grip" title={grip} className="ms-auto flex shrink-0 cursor-grab text-fg-subtle">
      <GripVertical className="size-[15px]" />
    </span>
  ) : null;

  if (compact) {
    // A swimlane's card (Kanban Swimlanes comp): tag and points, the title, then the owner and the card's id.
    return (
      <div className="flex flex-col rounded-[11px] border border-border bg-surface p-3 leading-[normal] shadow-card transition-[box-shadow,border-color] duration-150 hover:border-border-strong hover:shadow-[0_6px_18px_-8px_rgba(20,20,35,.28)]">
        {(card.tag !== undefined || card.priority !== undefined || card.points !== undefined || actionsSpace) && (
          <div className={`mb-2 flex min-h-[18px] items-center gap-1.5${actionsSpace ? ' pe-7' : ''}`}>
            {card.tag !== undefined && <Tag tone={boardToneOf(card.tagTone, columnTone)}>{card.tag}</Tag>}
            <PriorityPill card={card} />
            {card.points !== undefined && (
              <MonoText className="ms-auto rounded-[6px] bg-surface-3 px-1.5 py-px text-[10px] font-bold text-fg-subtle">
                {card.points}
                {pointsUnit === undefined ? 'pt' : ` ${pointsUnit}`}
              </MonoText>
            )}
          </div>
        )}
        <p className="mb-2.5 text-[13px] font-bold leading-[1.35] text-fg">{card.title}</p>
        <div className="flex items-center gap-[7px]">
          {initials !== undefined && <Avatar size="sm" name={card.owner ?? ''} className="size-[22px]" {...(locale === undefined ? {} : { locale })} />}
          <span className="min-w-0 truncate text-[11px] text-fg-subtle">{card.foot ?? card.id}</span>
        </div>
      </div>
    );
  }

  if (roadmap) {
    // The theme's colour is the card's: its tag and its bar.
    const tone = card.tag === undefined ? columnTone : boardToneOf(card.tagTone, columnTone);
    return (
      <div className="flex flex-col rounded-[12px] border border-border bg-surface p-[13px] leading-[normal] shadow-card transition-[box-shadow,border-color] duration-150 hover:border-border-strong hover:shadow-[0_6px_18px_-8px_rgba(20,20,35,.28)]">
        <div className={`mb-[9px] flex min-h-[18px] items-center gap-1.5${actionsSpace ? ' pe-7' : ''}`}>
          {card.tag !== undefined && (
            <Tag data-part="board-card-tag" tone={tone} className="rounded-full px-2 py-[2px] text-[10px] font-bold">
              {card.tag}
            </Tag>
          )}
          {gripMark}
        </div>
        <p className="mb-[11px] text-[13.5px] font-bold leading-[1.35] text-fg">{card.title}</p>
        {(hasPct || initials !== undefined) && (
          <div className="mb-1.5 flex items-center justify-between gap-2">
            {hasPct ? <span className="text-[11px] font-semibold text-fg-subtle">{t('ui:widgets.boards.pct', '{pct}%', { pct })}</span> : <span />}
            {initials !== undefined && (
              <Avatar size="sm" name={card.owner ?? ''} title={card.owner} className="size-6 text-[9.5px]" {...(locale === undefined ? {} : { locale })} />
            )}
          </div>
        )}
        {hasPct && (
          <div role="progressbar" aria-label={card.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-[6px] bg-surface-3">
            <div className={`h-full w-[var(--adm-pct)] rounded-[6px] ${BAR_TONE[tone]}`} style={{ '--adm-pct': `${String(pct)}%` }} />
          </div>
        )}
      </div>
    );
  }

  // The Project Board comp's card: priority and grip, title, who it is for, progress with the amount, owner and due day.
  return (
    <div className="flex flex-col rounded-[12px] border border-border bg-surface p-[14px] leading-[normal] shadow-card transition-[box-shadow,border-color] duration-150 hover:border-border-strong hover:shadow-[0_6px_18px_-8px_rgba(20,20,35,.28)]">
      {card.tag !== undefined || card.priority !== undefined || card.points !== undefined ? (
        <div className={`mb-2.5 flex min-h-[18px] items-center gap-2${actionsSpace ? ' pe-7' : ''}`}>
          {card.tag !== undefined && <Tag tone={boardToneOf(card.tagTone, columnTone)}>{card.tag}</Tag>}
          <PriorityPill card={card} />
          {card.points !== undefined && (
            <MonoText className={`${showGrip ? '' : 'ms-auto '}text-[11px] font-semibold text-fg-muted`}>
              {card.points}
              {pointsUnit === undefined ? '' : ` ${pointsUnit}`}
            </MonoText>
          )}
          {gripMark}
        </div>
      ) : null}

      {/* With nothing to put in the first line (no priority on the table), the grip stands beside the title. */}
      <div className={`mb-[5px] flex items-start gap-2${card.tag === undefined && card.priority === undefined && card.points === undefined && actionsSpace ? ' pe-7' : ''}`}>
        <p className="min-w-0 flex-1 text-[14px] font-bold tracking-[-0.01em] text-fg">{card.title}</p>
        {card.tag === undefined && card.priority === undefined && card.points === undefined ? gripMark : null}
      </div>

      {card.client !== undefined && (
        <p data-part="board-card-client" className="mb-[13px] flex min-w-0 items-center gap-[5px] text-[11.5px] text-fg-muted">
          <User aria-hidden="true" className="size-[13px] shrink-0" />
          <span className="truncate">{card.client}</span>
        </p>
      )}

      {card.budgetSecond !== undefined ? (
        // Two money lines: the amount and, at the line's end, the second one.
        <div data-part="board-card-amounts" className="mb-[13px] flex items-baseline gap-2">
          {card.budget !== undefined && <MonoText className="text-body-sm font-bold text-fg">{card.budget}</MonoText>}
          <MonoText data-part="board-card-second-amount" className="ms-auto shrink-0 text-caption text-fg-subtle">
            {card.budgetSecond}
          </MonoText>
        </div>
      ) : hasPct ? (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-fg-subtle">{t('ui:widgets.boards.pctComplete', '{pct}% Complete', { pct })}</span>
            {card.budget !== undefined && <MonoText className="text-[11px] font-semibold text-fg-muted">{card.budget}</MonoText>}
          </div>
          <div
            role="progressbar"
            aria-label={card.title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="mb-[13px] h-1.5 overflow-hidden rounded-[6px] bg-surface-3"
          >
            <div className={`h-full w-[var(--adm-pct)] rounded-[6px] ${BAR_TONE[columnTone]}`} style={{ '--adm-pct': `${String(pct)}%` }} />
          </div>
        </>
      ) : card.budget !== undefined ? (
        <MonoText data-part="board-card-amount" className="mb-[13px] text-[12px] font-bold text-fg-muted">
          {card.budget}
        </MonoText>
      ) : null}

      {card.lines !== undefined && card.lines.length > 0 && (
        <div data-part="board-card-lines" className="mb-[13px] flex flex-col gap-0.5 text-caption text-fg-muted">
          {card.lines.map((line, index) => (
            <div key={index} className="flex items-baseline justify-between gap-2">
              {line.label === undefined ? null : <span className="shrink-0 text-fg-subtle">{line.label}</span>}
              <span className="min-w-0 truncate">{line.value}</span>
            </div>
          ))}
        </div>
      )}

      {(initials !== undefined || card.due !== undefined || (card.foot !== undefined && card.foot !== '')) && (
        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex items-center">
            {initials !== undefined && (
              <Avatar size="sm" name={card.owner ?? ''} title={card.owner} className="ring-2 ring-surface" {...(locale === undefined ? {} : { locale })} />
            )}
            {card.foot !== undefined && card.foot !== '' && <MonoText className={`${initials === undefined ? '' : 'ms-2 '}text-[10px] text-fg-subtle`}>{card.foot}</MonoText>}
          </div>
          {card.due !== undefined && (
            <span data-part="board-card-due" className="inline-flex shrink-0 items-center gap-[5px] rounded-full border border-border bg-surface-2 px-[9px] py-[3px] text-[11px] font-semibold text-fg-muted">
              <Calendar aria-hidden="true" className="size-3" />
              {card.due}
            </span>
          )}
        </div>
      )}
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
  const t = useMaybeT();
  const card = boardCardOf(data, config);
  if (card === null) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={config.emptyState?.titleKey ?? t('ui:widgets.boards.boardCard.emptyTitle', 'No card')}
        body={config.emptyState?.bodyKey ?? t('ui:widgets.boards.boardCard.emptyBody', 'This card has no record bound to it yet.')}
      />
    );
  }
  const href = config.linkTarget ?? config.href;
  const body = (
    <BoardCard
      card={card}
      showGrip={false}
      columnTone={boardToneOf(config.columnTone, 'accent')}
      {...(config.format?.locale === undefined || config.format.locale.trim() === '' ? {} : { locale: config.format.locale })}
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
