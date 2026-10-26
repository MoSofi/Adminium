// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-board` template renderer (manifest `page-board.json`, annex).
 *
 * Renders the stored archetype config body on the 12-col grid: the required
 * `board` slot composes the boards family's REAL components
 * (`kanban-board` / `kanban-swimlane-grid` — dnd-kit optimistic move machinery
 * from M7 W2), translated from the candidate vocabulary the engine persists
 * (`statusColumn`/`laneColumn`/`titleColumn`/`progressColumn`/`columns[]` —
 * registry/candidates.ts `boards.workflow-enum`) to the components' props.
 *
 * Behaviors:
 * - drop issues ONE update intent through `onEvent` — status only on the
 *   kanban, lane+status atomically on swimlanes; the mutate promise is
 *   returned so a rejected write rolls the optimistic move back;
 * - a drop into a "Completed"-classified column forces `pct = 100` when the
 *   stored config names a progress column;
 * - the roadmap variant (`bucketBy: 'quarter'` + a date column in the stored
 *   config) buckets cards into quarter columns; a cross-quarter drop
 *   reschedules the record to the target quarter's first day;
 * - `inline-compose-card` quick-add inserts with the column defaults;
 * - card click emits `record-open` — the host routes it to the record drawer;
 * - every non-board item (KPI cards, insights) renders through WidgetHost.
 *
 * A board whose columns somebody named (an app's `config.board`, stored on
 * the item as `columnsFrom` / `columnsBinding` / `totals` / `only`) takes them from
 * the host (`boardColumns`): the rows of a table, in that table's order and
 * an empty one too, or an enum's values — each with the count and the totals
 * the SERVER worked out, since the cards listed stop at the list's limit. A
 * card is then placed by a link (a number as often as a word), and a drop
 * writes the column row's own key.
 */
import { getFormatters } from '@adminium/i18n';
import { useMaybeI18n, useMaybeT } from '../../lib/i18n.js';
import { pickLocalized } from '../../lib/localized.js';
import { Activity, ChevronLeft, ChevronRight, CircleCheck, Columns3, LayoutList, Plus, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { KanbanBoard } from '../../families/boards/KanbanBoard.js';
import { KanbanSwimlaneGrid } from '../../families/boards/KanbanSwimlaneGrid.js';
import { InlineComposeCard } from '../../families/boards/InlineComposeCard.js';
import { refusalReasonOf, type BoardAddRefusal } from '../../families/boards/board-dnd.js';
import {
  boardRowsOf,
  boardToneOf,
  priorityTone,
  resolveColumns,
  resolveLanes,
  toBoardCard,
  type BoardCardData,
  type ColumnDef,
  type ColumnDefInput,
  type LaneDefInput,
} from '../../families/boards/board-lib.js';
import { servedChoicesOf } from '../../families/tables/choices.js';
import { BOARD_CARD_DAYS_ALIAS, BOARD_CARD_LANE_ALIAS, BOARD_CARD_LINK_ALIAS, BOARD_CARD_OWNER_ALIAS, type BoardBadge, type BoardCardFacts, type BoardNote, type BoardStat, type BoardToolbar } from '../../registry/board-facts.js';
import { WidgetFrame } from '../../frame/WidgetFrame.js';
import { fmtMonthDay } from '../../families/calendar/calendar-lib.js';
import { UnplacedRowsNotice, nothingPlaced } from '../planning/UnplacedRowsNotice.js';
import { WidgetHost, type WidgetDataState } from '../../frame/WidgetHost.js';
import { DashboardGrid } from '../../grid/DashboardGrid.js';
import type { LayoutItem } from '../../grid/layout-schema.js';
import type { WidgetEvent } from '../../registry/types.js';
import { withCurrency } from '../page-currency.js';
import {
  configString,
  dayStartValue,
  isCompletedColumn,
  itemConfigOf,
  parseTemplateConfig,
  planningDateKindOf,
  planningSourceOf,
  quarterKeyOf,
  quarterLabelOf,
  quarterStartIso,
  splitInstant,
  todayIso,
  type PlanningDateOptions,
  useTemplateStates,
  type TemplateDataStates,
} from '../planning/planning-lib.js';

export const PAGE_BOARD_TEMPLATE_ID = 'page-board';

const BOARD_WIDGET_IDS = new Set(['kanban-board', 'kanban-swimlane-grid']);
const COMPOSE_WIDGET_ID = 'inline-compose-card';

export interface PageBoardLabels {
  addLabel?: string | undefined;
  composePlaceholder?: string | undefined;
  composeAdd?: string | undefined;
  composeCancel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  /** The empty state when the query succeeded and the table has no rows yet. */
  noRowsTitle?: string | undefined;
  noRowsBody?: string | undefined;
}

/** One column of a board, as the host read it: a row of the columns' table, or a value of the enum. */
export interface BoardColumnRow {
  /** What a card's column value is matched with, as text. */
  id: string;
  /** The same key as the row holds it (a number, for most links): what a drop writes. Absent ⇒ `id`. */
  value?: string | number | undefined;
  /** What the column is headed with; absent ⇒ the board's own word for `id`. */
  label?: string | undefined;
  /** Every card of the column the reader reaches, counted by the server. */
  count?: number | undefined;
  /** The column's totals, formatted and joined, for its header. */
  total?: string | undefined;
  /** A few quiet characters beside the heading, already written ("10%": a stage's odds, read from the column's own row). */
  badge?: string | undefined;
}

/** The host's read of a board's columns. */
export interface BoardColumnsState {
  status: 'loading' | 'success' | 'error';
  columns?: readonly BoardColumnRow[] | undefined;
  /** The table has more rows than a board draws as columns: `columns` are the first of them, and the board says so. */
  more?: boolean | undefined;
  error?: unknown;
  refetch?: (() => void) | undefined;
}

/** The instance id the host gives the per-column query of board item `i` (`config.columnsBinding`), fetched in the same batch as its cards. */
export function boardColumnsInstanceId(instanceId: string): string {
  return `${instanceId}:columns`;
}

/** The instance id of the n-th figure of board item `i`'s toolbar total (`config.toolbarBindings`): the count first, then each total. */
export function boardToolbarInstanceId(instanceId: string, index: number): string {
  return `${instanceId}:toolbar:${String(index)}`;
}

/** The instance id of the n-th figure of board item `i`'s summary (`config.statBindings`). */
export function boardStatInstanceId(instanceId: string, index: number): string {
  return `${instanceId}:stat:${String(index)}`;
}

/** The instance id of the people board item `i`'s person filter offers (`config.personBinding`). */
export function boardPeopleInstanceId(instanceId: string): string {
  return `${instanceId}:people`;
}

export interface PageBoardProps {
  /** The stored page config body: `{ templateVersion, toolbar, overlays, layout }`. */
  config: unknown;
  /**
   * The board's columns as the host read them, for a board that names them
   * (`columnsFrom` or `columnsBinding` on its item). Absent ⇒ the columns are
   * worked out of the cards and the stored list, as before.
   */
  boardColumns?: BoardColumnsState | undefined;
  /** Per-instance data states from the host binding; absent → demo data. */
  states?: TemplateDataStates | undefined;
  /** Widget event sink. `mutate` handlers may return the CRUD promise so the
   *  boards' optimistic machinery can roll a rejected move back. */
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  /**
   * IANA zone a roadmap buckets dates in (a timestamp is converted into it
   * before its quarter is taken; a cross-quarter drop writes the quarter's
   * first midnight in it). Absent ⇒ the viewer's zone.
   */
  timeZone?: string | undefined;
  /** Today's day (`YYYY-MM-DD`), which year a roadmap opens on; pinned by stories and tests. Absent ⇒ today in `timeZone`. */
  today?: string | undefined;
  locale?: string | undefined;
  dir?: 'ltr' | 'rtl' | undefined;
  labels?: PageBoardLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
  /**
   * The connection's currency, for a stored widget that names none (a KPI
   * card's money) — merged as the page draws, never into the stored layout.
   */
  currency?: string | undefined;
  /**
   * How a card's amount is written, by the column it is read from: the host
   * knows which columns are money and in which currency. Absent ⇒ a plain
   * number in the reader's language.
   */
  formatAmount?: ((column: string, amount: number) => string) | undefined;
  /**
   * The person the board is narrowed to by its toolbar's filter (`toolbar.person`), or null for everyone. The host
   * holds it, and asks the cards, the columns' figures and the total again of that person's cards alone.
   */
  person?: string | null | undefined;
  /** The toolbar's filter was set: a person's id, or null for everyone. Absent ⇒ no filter is drawn. */
  onPersonChange?: ((person: string | null) => void) | undefined;
  /**
   * The toolbar's totals as its header writes them (`totals`, in order), from the server's figures: money in its
   * currency, two of them named. Absent ⇒ plain numbers.
   */
  formatTotals?: ((values: readonly (number | null)[]) => string | undefined) | undefined;
  /** What one card, and several, are called ("deal", "deals"), in the reader's language. Absent ⇒ "card", "cards". */
  entityLabels?: { one: string; other: string } | undefined;
  /** What the person filter's column is called ("Owner"), in the reader's language. */
  personLabel?: string | undefined;
}

/** What a board's toolbar was answered: each figure of its total, and the people its filter offers. */
interface BoardToolbarStates {
  figures: readonly (WidgetDataState | undefined)[];
  people: WidgetDataState | undefined;
}

/** A single figure as the server answered it, or null for none. */
function figureOf(state: WidgetDataState | undefined): number | null | undefined {
  if (state?.status !== 'success') return undefined;
  const value = (state.data as { value?: unknown } | null | undefined)?.value;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** The people a board's filter offers, as the server named them (a chart's groups of a staff column). */
function peopleOf(state: WidgetDataState | undefined): { id: string; name: string }[] {
  if (state?.status !== 'success') return [];
  const items = (state.data as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return (items as { key?: unknown; label?: unknown }[]).flatMap((item) =>
    (typeof item.key === 'string' || typeof item.key === 'number') && item.key !== '__other' ? [{ id: String(item.key), name: typeof item.label === 'string' && item.label !== '' ? item.label : String(item.key) }] : [],
  );
}

/** What each person's button says: their first name, or the whole name where two share one (as the comp draws: "Dana"). */
export function shortNames(people: readonly { id: string; name: string }[]): Map<string, string> {
  const first = (name: string): string => name.trim().split(/\s+/u)[0] ?? name;
  const counts = new Map<string, number>();
  for (const one of people) counts.set(first(one.name), (counts.get(first(one.name)) ?? 0) + 1);
  return new Map(people.map((one) => [one.id, (counts.get(first(one.name)) ?? 0) > 1 ? one.name : first(one.name)]));
}

/**
 * The line above a board that says so (`config.board.toolbar`, the comp's
 * toolbar): the person filter — "Everyone" and each person who holds cards on
 * the board — then the total, then the board's note at the line's end.
 */
function BoardToolbarLine({
  toolbar,
  states,
  figures,
  person,
  onPersonChange,
  formatTotals,
  entityLabels,
  personLabel,
  note,
  language,
}: {
  toolbar: BoardToolbar;
  states: BoardToolbarStates;
  figures: number;
  person: string | null;
  onPersonChange: ((person: string | null) => void) | undefined;
  formatTotals: PageBoardProps['formatTotals'];
  entityLabels: PageBoardProps['entityLabels'];
  personLabel: string | undefined;
  note: ReactNode;
  language: string | undefined;
}) {
  const t = useMaybeT();
  const offered = useMemo(() => peopleOf(states.people), [states.people]);
  // A person chosen and since gone from the list (their last card moved on) stays a button, by the name last seen.
  const [seen, setSeen] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (offered.length === 0) return;
    setSeen((before) => {
      const next = new Map(before);
      for (const one of offered) next.set(one.id, one.name);
      return next;
    });
  }, [offered]);
  const people = person === null || offered.some((one) => one.id === person) ? offered : [...offered, { id: person, name: seen.get(person) ?? person }];
  const names = shortNames(people);
  const filtering = toolbar.person !== undefined && onPersonChange !== undefined && (people.length > 1 || person !== null);
  // The total: the server's figures, all of them answered, or nothing yet.
  const values = Array.from({ length: figures }, (_, index) => figureOf(states.figures[index]));
  const answered = toolbar.total === true && figures > 0 && values.every((value) => value !== undefined);
  let total: string | undefined;
  if (answered) {
    const count = values[0] ?? 0;
    const counted =
      entityLabels === undefined
        ? t('ui:templates.board.toolbarCount', '{count, plural, one {# card} other {# cards}}', { count })
        : t('ui:templates.board.toolbarCountNamed', '{count, plural, one {# {one}} other {# {other}}}', { count, one: entityLabels.one, other: entityLabels.other });
    const rest = values.slice(1) as (number | null)[];
    const fmt = getFormatters(language ?? 'en-US');
    const totals = rest.length === 0 ? undefined : (formatTotals?.(rest) ?? rest.filter((value): value is number => value !== null).map((value) => fmt.number(value, { maximumFractionDigits: 2 })).join(' · '));
    total = [counted, ...(totals === undefined || totals === '' ? [] : [totals])].join(' · ');
  }
  if (!filtering && total === undefined && note === null) return null;
  const segment = (on: boolean): string =>
    `whitespace-nowrap rounded-lg px-3 py-[7px] text-caption font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${on ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'}`;
  return (
    <div role="toolbar" aria-label={t('ui:templates.board.toolbar', 'Board')} data-testid="board-toolbar" className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-3 pt-2">
      {filtering ? (
        <div role="group" aria-label={personLabel ?? t('ui:templates.board.person', 'Person')} data-testid="board-person-filter" className="flex flex-wrap gap-[3px] rounded-[11px] border border-border bg-surface-2 p-[3px]">
          <button type="button" aria-pressed={person === null} className={segment(person === null)} onClick={() => onPersonChange?.(null)}>
            {t('ui:templates.board.everyone', 'Everyone')}
          </button>
          {people.map((one) => (
            <button
              key={one.id}
              type="button"
              aria-pressed={person === one.id}
              aria-label={one.name}
              title={one.name}
              className={segment(person === one.id)}
              onClick={() => onPersonChange?.(one.id)}
            >
              {names.get(one.id) ?? one.name}
            </button>
          ))}
        </div>
      ) : null}
      {total === undefined ? null : (
        // Said again when the filter or a colleague's change moves it.
        <span data-testid="board-total" aria-live="polite" className="font-mono text-caption tabular-nums text-fg-muted">
          {total}
        </span>
      )}
      {note}
    </div>
  );
}

/**
 * A table's name inside a sentence ("New project"): lower case where the
 * language writes common nouns so, unless it reads as an acronym ("API key").
 * German keeps its capital; scripts without case are left as they are.
 */
export function inSentence(word: string, language: string | undefined): string {
  const lang = (language ?? 'en').slice(0, 2).toLowerCase();
  if (!['en', 'fr', 'da', 'cs'].includes(lang) || word.length === 0) return word;
  const second = word.charAt(1);
  if (second !== '' && second === second.toUpperCase() && second !== second.toLowerCase()) return word;
  // The app writes its locales `en_US`; a language tag is `en-US`, and a malformed one must not take the page down.
  let lower: string;
  try {
    lower = word.charAt(0).toLocaleLowerCase(lang);
  } catch {
    lower = word.charAt(0).toLowerCase();
  }
  return lower + word.slice(1);
}

const STAT_ICONS: Record<BoardStat['kind'], LucideIcon> = { total: LayoutList, column: Activity, amount: Wallet, people: Users };

/**
 * The figures above the board (the Project Board comp's summary cards): an
 * icon, a pill (the share of all cards, or those added lately), the figure
 * and what it is. Each figure is the server's, one query each; a figure not
 * answered yet reads "—".
 */
function BoardStats({
  stats,
  states,
  columnLabel,
  formatAmount,
  language,
}: {
  stats: readonly BoardStat[];
  states: readonly (WidgetDataState | undefined)[];
  columnLabel: (value: string) => string;
  formatAmount: PageBoardProps['formatAmount'];
  language: string | undefined;
}) {
  const fmt = getFormatters(language ?? 'en-US');
  const total = (() => {
    const first = stats.find((stat) => stat.kind === 'total');
    return first === undefined ? undefined : figureOf(states[first.figure]);
  })();
  const grid = ['', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-2 xl:grid-cols-3', 'sm:grid-cols-2 xl:grid-cols-4'][stats.length] ?? 'sm:grid-cols-2 xl:grid-cols-4';
  return (
    <div data-testid="board-stats" className={`grid grid-cols-1 gap-4 ${grid}`}>
      {stats.map((stat, index) => {
        const value = figureOf(states[stat.figure]);
        const Icon = stat.kind === 'column' && index > 1 ? CircleCheck : STAT_ICONS[stat.kind];
        const written =
          value === undefined || value === null
            ? '—'
            : stat.kind === 'amount' && stat.column !== undefined
              ? (formatAmount?.(stat.column, value) ?? fmt.number(value, { maximumFractionDigits: 2 }))
              : fmt.number(value, { maximumFractionDigits: 0 });
        const label = stat.kind === 'column' && stat.value !== undefined ? columnLabel(stat.value) : (stat.label ?? '');
        const delta = stat.delta === undefined ? undefined : figureOf(states[stat.delta]);
        const share = stat.share === true && typeof value === 'number' && typeof total === 'number' && total > 0 ? Math.round((value / total) * 100) : undefined;
        const pill =
          delta !== undefined && delta !== null
            ? { text: `+${fmt.number(delta, { maximumFractionDigits: 0 })}`, Glyph: TrendingUp, good: delta > 0 }
            : share !== undefined
              ? { text: fmt.number(share / 100, { style: 'percent', maximumFractionDigits: 0 }), Glyph: Activity, good: false }
              : undefined;
        return (
          <div key={`${stat.kind}-${String(index)}`} data-part="board-stat" className="rounded-[14px] border border-border bg-surface px-5 py-[18px] leading-[normal] shadow-card">
            <div className="mb-3.5 flex items-center justify-between">
              <span aria-hidden="true" className="flex size-[34px] items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <Icon className="size-[17px]" />
              </span>
              {pill === undefined ? null : (
                <span className={`inline-flex items-center gap-[3px] rounded-full px-[7px] py-[2px] text-[11.5px] font-bold ${pill.good ? 'bg-pos-soft text-pos' : 'bg-surface-3 text-fg-muted'}`}>
                  <pill.Glyph aria-hidden="true" className="size-3" />
                  {pill.text}
                </span>
              )}
            </div>
            <div className="font-mono text-[26px] font-semibold tabular-nums tracking-[-0.03em] text-fg">{written}</div>
            <div className="mt-[3px] text-[12.5px] text-fg-muted">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

/** The stored board item config, normalized from the candidate vocabulary. */
interface BoardItemConfig {
  statusColumn: string;
  laneColumn: string | undefined;
  titleColumn: string;
  progressColumn: string | undefined;
  columnDefs: ColumnDefInput[] | undefined;
  laneDefs: LaneDefInput[] | undefined;
  roadmap: boolean;
  dateColumn: string | undefined;
  allowAdd: boolean;
  /** The table whose rows are the columns, by the id the data routes take; `key` is its column a card's link holds. */
  columnsFrom: BoardColumnsFrom | undefined;
  /** The figures a column's header shows beside its count. */
  totals: BoardTotal[];
  /** Which cards are on the board: a card passes every test. The host asks each column's count and totals of these cards. */
  only: BoardOnlyTest[];
  /**
   * The stored `only` cannot be read as written, or says something the cards'
   * own query does not: the board is not drawn. Reading what could be read of
   * it would head each column with a figure of cards the board does not list
   * (or list cards its headers do not count).
   */
  onlyInvalid: boolean;
  /** What a card shows under its title (an app's `config.board.card`). */
  card: BoardCardFacts;
  /** A sentence above the board (an app's `config.board.note`). */
  note: BoardNote | undefined;
  /** A line above the board (an app's `config.board.toolbar`): the server's total, a person filter. */
  toolbar: BoardToolbar | undefined;
  /** How many figures the toolbar's total is asked as (`config.toolbarBindings`): the count, then each total. */
  toolbarFigures: number;
  /** The summary figures above the board (`config.stats`, asked as `config.statBindings`). */
  stats: BoardStat[];
}

/** One test a card passes to be on its board: its `column` holds one of `in`. */
export interface BoardOnlyTest {
  column: string;
  in: (string | number | boolean)[];
}

export interface BoardColumnsFrom {
  table: string;
  key: string;
  label: string;
  order: string | undefined;
  /** One more column of the columns' rows, drawn small beside each heading. */
  badge?: BoardBadge | undefined;
}

export interface BoardTotal {
  column: string;
  fn: 'sum' | 'avg';
}

function columnsFromOf(config: Record<string, unknown>): BoardColumnsFrom | undefined {
  const raw = config['columnsFrom'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const from = raw as Record<string, unknown>;
  const table = configString(from, 'table');
  const label = configString(from, 'label');
  if (table === undefined || label === undefined) return undefined;
  const rawBadge = typeof from['badge'] === 'object' && from['badge'] !== null ? (from['badge'] as Record<string, unknown>) : undefined;
  const badgeColumn = rawBadge === undefined ? undefined : configString(rawBadge, 'column');
  const as = rawBadge?.['as'];
  return {
    table,
    label,
    key: configString(from, 'key') ?? 'id',
    order: configString(from, 'order'),
    ...(badgeColumn === undefined ? {} : { badge: { column: badgeColumn, ...(as === 'text' || as === 'number' || as === 'percent' ? { as } : {}) } }),
  };
}

/** A short stored label and the same by language: text only, nothing empty. */
function labelsOf(from: Record<string, unknown> | undefined): { label?: string; labels?: Record<string, string> } {
  const label = from === undefined ? undefined : configString(from, 'label');
  if (label === undefined) return {};
  const raw = from?.['labels'];
  const labels = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')) : undefined;
  return { label, ...(labels === undefined || Object.keys(labels).length === 0 ? {} : { labels }) };
}

/** The stored `toolbar`: a total, a person filter by a column, or nothing. */
function toolbarOf(config: Record<string, unknown>): BoardToolbar | undefined {
  const raw = config['toolbar'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const toolbar = raw as Record<string, unknown>;
  const person = configString(toolbar, 'person');
  if (toolbar['total'] !== true && person === undefined) return undefined;
  return { ...(toolbar['total'] === true ? { total: true } : {}), ...(person === undefined ? {} : { person }) };
}

/** The stored `card`: each piece that names a column, and nothing it cannot read. */
function cardFactsOf(config: Record<string, unknown>): BoardCardFacts {
  const raw = config['card'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const card = raw as Record<string, unknown>;
  const rawDays = typeof card['daysSince'] === 'object' && card['daysSince'] !== null ? (card['daysSince'] as Record<string, unknown>) : undefined;
  const daysColumn = rawDays === undefined ? undefined : configString(rawDays, 'column');
  const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined);
  const link = configString(card, 'link');
  const rawSecond = typeof card['secondAmount'] === 'object' && card['secondAmount'] !== null ? (card['secondAmount'] as Record<string, unknown>) : undefined;
  const secondColumn = rawSecond === undefined ? undefined : configString(rawSecond, 'column');
  return {
    ...(link === undefined || !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(link) ? {} : { link }),
    ...(configString(card, 'person') === undefined ? {} : { person: configString(card, 'person') }),
    ...(configString(card, 'amount') === undefined ? {} : { amount: configString(card, 'amount') }),
    ...(secondColumn === undefined ? {} : { secondAmount: { column: secondColumn, ...labelsOf(rawSecond) } }),
    ...(daysColumn === undefined ? {} : { daysSince: { column: daysColumn, warnFrom: whole(rawDays?.['warnFrom']), alertFrom: whole(rawDays?.['alertFrom']), ...labelsOf(rawDays) } }),
    ...(configString(card, 'date') === undefined ? {} : { date: configString(card, 'date') }),
    ...(pathsOf(card['owner']) === undefined ? {} : { owner: pathsOf(card['owner']) }),
    ...(configString(card, 'priority') === undefined ? {} : { priority: configString(card, 'priority') }),
    ...(configString(card, 'tag') === undefined ? {} : { tag: configString(card, 'tag') }),
    ...(card['laneName'] === 'owner' ? { laneName: 'owner' as const } : pathsOf(card['laneName']) === undefined ? {} : { laneName: pathsOf(card['laneName']) }),
  };
}

/** One or two stored `<link>.<column>` paths, or nothing. */
function pathsOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const paths = raw.filter((path): path is string => typeof path === 'string' && /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(path)).slice(0, 2);
  return paths.length === 0 ? undefined : paths;
}

/** The stored summary figures (`config.stats`): each names its query by index, and nothing it cannot read is kept. */
function statsOf(config: Record<string, unknown>): BoardStat[] {
  const raw = config['stats'];
  const asked = Array.isArray(config['statBindings']) ? (config['statBindings'] as unknown[]).length : 0;
  if (!Array.isArray(raw)) return [];
  const index = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < asked ? value : undefined);
  const out: BoardStat[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const stat = entry as Record<string, unknown>;
    const kind = stat['kind'];
    const figure = index(stat['figure']);
    if ((kind !== 'total' && kind !== 'column' && kind !== 'amount' && kind !== 'people') || figure === undefined) continue;
    const delta = index(stat['delta']);
    out.push({
      kind,
      figure,
      ...(configString(stat, 'label') === undefined ? {} : { label: configString(stat, 'label') }),
      ...(configString(stat, 'value') === undefined ? {} : { value: configString(stat, 'value') }),
      ...(configString(stat, 'column') === undefined ? {} : { column: configString(stat, 'column') }),
      ...(stat['share'] === true ? { share: true as const } : {}),
      ...(delta === undefined ? {} : { delta }),
    });
  }
  return out.slice(0, 4);
}

/** The stored `note`: its sentence, by language, and an address inside this workspace (any other is dropped). */
function noteOf(config: Record<string, unknown>): BoardNote | undefined {
  const raw = config['note'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const note = raw as Record<string, unknown>;
  const text = configString(note, 'text');
  if (text === undefined) return undefined;
  const texts = typeof note['texts'] === 'object' && note['texts'] !== null ? Object.fromEntries(Object.entries(note['texts'] as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')) : undefined;
  const href = configString(note, 'href');
  return { text, ...(texts === undefined ? {} : { texts }), ...(href !== undefined && /^\/(?!\/)[^\s\\]*$/.test(href) ? { href } : {}) };
}

function totalsOf(config: Record<string, unknown>): BoardTotal[] {
  const raw = config['totals'];
  if (!Array.isArray(raw)) return [];
  const out: BoardTotal[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const column = configString(entry as Record<string, unknown>, 'column');
    const fn = (entry as Record<string, unknown>)['fn'];
    if (column !== undefined && (fn === 'sum' || fn === 'avg')) out.push({ column, fn });
  }
  return out.slice(0, 2);
}

const isOnlyValue = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/**
 * The stored `only`, whole or not at all: null when any part of it cannot be
 * read (it is not a list, a test names no column, lists no value or a value
 * that is none). A test dropped in silence would leave the headers counting
 * cards the board was told to leave out.
 */
function onlyOf(config: Record<string, unknown>): BoardOnlyTest[] | null {
  const raw = config['only'];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: BoardOnlyTest[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const column = configString(entry as Record<string, unknown>, 'column');
    const values = (entry as Record<string, unknown>)['in'];
    if (column === undefined || !Array.isArray(values) || values.length === 0 || !values.every(isOnlyValue)) return null;
    out.push({ column, in: [...values] });
  }
  return out;
}

/**
 * Whether the cards' own query (`binding.filters`) asks every test of `only`,
 * value for value. The two are written together by whoever composes the board;
 * a board whose headers are asked one thing and whose cards another is not
 * drawn. A board with no stored query (a demo) has nothing to disagree with.
 */
function cardsAskOnly(config: Record<string, unknown>, only: readonly BoardOnlyTest[]): boolean {
  const binding = config['binding'];
  if (only.length === 0 || typeof binding !== 'object' || binding === null) return true;
  const filters = (binding as Record<string, unknown>)['filters'];
  const asked = Array.isArray(filters) ? (filters as { column?: unknown; op?: unknown; value?: unknown }[]) : [];
  return only.every((test) =>
    asked.some(
      (filter) =>
        typeof filter === 'object' &&
        filter !== null &&
        filter.column === test.column &&
        filter.op === 'in' &&
        Array.isArray(filter.value) &&
        filter.value.length === test.in.length &&
        test.in.every((value, index) => (filter.value as unknown[])[index] === value),
    ),
  );
}

/** Accepts both `columns: ['todo', …]` (engine) and `columnDefs: [{id…}]`. */
function columnDefsOf(config: Record<string, unknown>): ColumnDefInput[] | undefined {
  const raw = config['columns'] ?? config['columnDefs'];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const defs: ColumnDefInput[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') defs.push({ id: entry });
    else if (typeof entry === 'object' && entry !== null) defs.push(entry as ColumnDefInput);
  }
  return defs.length > 0 ? defs : undefined;
}

function laneDefsOf(config: Record<string, unknown>): LaneDefInput[] | undefined {
  const raw = config['lanes'] ?? config['laneDefs'];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const defs: LaneDefInput[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') defs.push({ id: entry });
    else if (typeof entry === 'object' && entry !== null) defs.push(entry as LaneDefInput);
  }
  return defs.length > 0 ? defs : undefined;
}

/**
 * What a new card is given so that it is ON a board of some of its table's
 * rows (`only`): each test that names exactly one value is that value. A test
 * that lists several says nothing of which one a new card has: that is left
 * to the column's own default.
 */
export function onlyDefaultsOf(only: readonly BoardOnlyTest[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const test of only) if (test.in.length === 1) out[test.column] = test.in[0] as string | number | boolean;
  return out;
}

export function boardItemConfigOf(config: Record<string, unknown>): BoardItemConfig {
  const only = onlyOf(config);
  return {
    statusColumn: configString(config, 'statusColumn', 'columnField') ?? 'status',
    laneColumn: configString(config, 'laneColumn', 'laneField'),
    titleColumn: configString(config, 'titleColumn', 'titleField') ?? 'title',
    progressColumn: configString(config, 'progressColumn'),
    columnDefs: columnDefsOf(config),
    laneDefs: laneDefsOf(config),
    roadmap: config['bucketBy'] === 'quarter' || config['roadmap'] === true,
    dateColumn: configString(config, 'dateColumn', 'startColumn', 'due'),
    allowAdd: config['allowAdd'] === true,
    columnsFrom: columnsFromOf(config),
    totals: totalsOf(config),
    only: only ?? [],
    onlyInvalid: only === null || !cardsAskOnly(config, only),
    card: cardFactsOf(config),
    note: noteOf(config),
    toolbar: toolbarOf(config),
    toolbarFigures: Array.isArray(config['toolbarBindings']) ? (config['toolbarBindings'] as unknown[]).length : 0,
    stats: statsOf(config),
  };
}

/**
 * The board's columns once the host has read them. A board over a table IS
 * those rows, in their order; a board over an enum keeps its own columns and
 * takes each one's count and total from the host's row of the same id.
 */
export function boardColumnDefsOf(
  own: readonly ColumnDef[],
  read: readonly BoardColumnRow[],
  fromTable: boolean,
  words?: Readonly<Record<string, string>> | undefined,
): ColumnDef[] {
  const figures = (row: BoardColumnRow | undefined) => ({
    ...(row?.count === undefined ? {} : { count: row.count }),
    ...(row?.total === undefined ? {} : { total: row.total }),
    ...(row?.badge === undefined ? {} : { badge: row.badge }),
  });
  if (fromTable) {
    const base = resolveColumns([], read.map((row) => ({ id: row.id, ...(row.label === undefined ? {} : { label: row.label }) })), words);
    return base.map((column, index) => ({ ...column, ...figures(read[index]) }));
  }
  const byId = new Map(read.map((row) => [row.id, row]));
  // A value the server counted no card under is a column with none, not one whose count is unknown.
  return own.map((column) => ({ ...column, count: 0, ...figures(byId.get(column.id)) }));
}

/**
 * Rows → cards with the stored column mapping (+ progress patch + roadmap
 * bucketing). A roadmap buckets by the date's day in `dates.timeZone`, read
 * per the column's kind — the same rule as the calendar.
 */
export function boardCardsOf(
  rows: Record<string, unknown>[],
  cfg: BoardItemConfig,
  dates: PlanningDateOptions = {},
  /** The column a row is opened by, as the answer names it. */
  keyField?: string,
  /** How the card's own facts (`cfg.card`) are written; absent ⇒ none is drawn. */
  facts?: BoardCardWriter | undefined,
): BoardCardData[] {
  return rows.map((row, index) => {
    const card = toBoardCard(row, index, {
      ...(keyField === undefined ? {} : { keyField }),
      columnField: cfg.statusColumn,
      titleField: cfg.titleColumn,
      ...(cfg.laneColumn === undefined ? {} : { laneField: cfg.laneColumn }),
    });
    if (cfg.progressColumn !== undefined) {
      const pct = row[cfg.progressColumn];
      if (typeof pct === 'number' && Number.isFinite(pct)) card.pct = pct;
    }
    if (cfg.roadmap && cfg.dateColumn !== undefined) {
      card.column = quarterKeyOf(splitInstant(row[cfg.dateColumn], dates)?.day ?? '');
    }
    if (facts !== undefined) writeCardFacts(card, row, cfg.card, facts);
    return card;
  });
}

/** What turns a row's raw values into a card's words: the host's formats and the answer's own names. */
export interface BoardCardWriter {
  /** The name each person in the rows goes by, as the server answered (`people`): an id that is not in it is drawn as nobody. */
  people: Readonly<Record<string, string>>;
  amount: (column: string, value: number) => string;
  /** A stored day or instant as a day in the reader's language; undefined when it is no date. */
  day: (column: string, value: unknown) => string | undefined;
  /** "12 days", in the reader's language. */
  days: (count: number) => string;
  /** One of the board's own short labels, in the reader's language (`label`, or `labels` by language). Absent ⇒ `label` as written. */
  label?: ((label: string, labels: Readonly<Record<string, string>> | undefined) => string) | undefined;
  /** "12 days in stage": the days, then what they are. Absent ⇒ the two with a space. */
  daysLabelled?: ((days: string, label: string) => string) | undefined;
  /** "w €12,000": a second amount after its label. Absent ⇒ the two with a space. */
  secondAmount?: ((label: string, amount: string) => string) | undefined;
  /** A choice column's words and tone for one of its values, as the answer gave them. */
  choice?: ((column: string, value: string) => { label?: string | undefined; tone?: string | undefined }) | undefined;
}

/**
 * The card's declared facts, each from what the SERVER answered: the name
 * looked up through a link (empty when its row is out of the reader's
 * reach), the person's name (never the id), the amount, the days the server
 * counted, the date. A fact with no value is simply not drawn.
 */
function writeCardFacts(card: BoardCardData, row: Record<string, unknown>, asked: BoardCardFacts, facts: BoardCardWriter): void {
  if (asked.link !== undefined) {
    const name = row[BOARD_CARD_LINK_ALIAS];
    card.client = typeof name === 'string' && name !== '' ? name : typeof name === 'number' ? String(name) : undefined;
  }
  if (asked.person !== undefined) {
    const id = row[asked.person];
    card.owner = typeof id === 'string' ? facts.people[id] : undefined;
  }
  const labelled = (label: string | undefined, labels: Readonly<Record<string, string>> | undefined): string | undefined =>
    label === undefined ? undefined : (facts.label?.(label, labels) ?? label);
  const amountOf = (column: string): string | undefined => {
    const raw = row[column];
    const amount = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
    return Number.isFinite(amount) ? facts.amount(column, amount) : undefined;
  };
  if (asked.amount !== undefined) card.budget = amountOf(asked.amount);
  if (asked.secondAmount !== undefined) {
    // A second money line (a deal's weighted value): its label first, in the reader's language.
    const amount = amountOf(asked.secondAmount.column);
    const label = labelled(asked.secondAmount.label, asked.secondAmount.labels);
    card.budgetSecond = amount === undefined ? undefined : label === undefined ? amount : (facts.secondAmount?.(label, amount) ?? `${label} ${amount}`);
  }
  if (asked.daysSince !== undefined) {
    const count = row[BOARD_CARD_DAYS_ALIAS];
    if (typeof count === 'number' && Number.isFinite(count)) {
      // The days, and what they are when the board says ("12 days in stage").
      const days = facts.days(count);
      const label = labelled(asked.daysSince.label, asked.daysSince.labels);
      card.tag = label === undefined ? days : (facts.daysLabelled?.(days, label) ?? `${days} ${label}`);
      card.tagTone = asked.daysSince.alertFrom !== undefined && count >= asked.daysSince.alertFrom ? 'danger' : asked.daysSince.warnFrom !== undefined && count >= asked.daysSince.warnFrom ? 'warn' : 'neutral';
    } else {
      card.tag = undefined;
    }
  }
  if (asked.date !== undefined) card.due = facts.day(asked.date, row[asked.date]);
  // The person a link names, and the lane's name where the lane is a link: the values read through it, joined.
  const joined = (alias: string, count: number): string | undefined => {
    const parts = Array.from({ length: count }, (_, index) => row[`${alias}_${String(index)}`]).filter((part): part is string | number => (typeof part === 'string' && part.trim() !== '') || typeof part === 'number');
    return parts.length === 0 ? undefined : parts.map(String).join(' ');
  };
  if (asked.owner !== undefined) card.owner = joined(BOARD_CARD_OWNER_ALIAS, asked.owner.length);
  if (asked.laneName === 'owner') card.laneLabel = card.owner;
  else if (asked.laneName !== undefined) card.laneLabel = joined(BOARD_CARD_LANE_ALIAS, asked.laneName.length);
  if (asked.priority !== undefined) {
    const raw = row[asked.priority];
    const value = typeof raw === 'string' && raw !== '' ? raw : undefined;
    const words = value === undefined ? undefined : facts.choice?.(asked.priority, value);
    card.priority = value === undefined ? undefined : (words?.label ?? value);
    card.priorityTone = words?.tone === undefined ? undefined : boardToneOf(words.tone, priorityTone(value));
  }
  if (asked.tag !== undefined) {
    const raw = row[asked.tag];
    const value = typeof raw === 'string' && raw !== '' ? raw : undefined;
    const words = value === undefined ? undefined : facts.choice?.(asked.tag, value);
    card.tag = value === undefined ? undefined : (words?.label ?? value);
    card.tagTone = value === undefined ? undefined : boardToneOf(words?.tone, 'accent');
  }
}

/** A quarter's colour, as the Kanban Roadmap comp heads them: Q1 green, Q2 accent, Q3 amber, Q4 grey. */
const QUARTER_TONES: Record<string, ColumnDef['tone']> = { '1': 'pos', '2': 'accent', '3': 'warn', '4': 'neutral' };

/**
 * Roadmap columns, chronologically. With `year`, the Kanban Roadmap comp's
 * year: its four quarters, empty or not (the board steps from year to year).
 * Without it, the quarters the cards are in.
 */
export function quarterColumnsOf(cards: readonly BoardCardData[], year?: number): ColumnDef[] {
  const keys =
    year === undefined
      ? [...new Set(cards.map((card) => card.column).filter((key) => key !== ''))].sort()
      : [1, 2, 3, 4].map((q) => `${String(year)}-Q${String(q)}`);
  return keys.map((key) => ({
    id: key,
    // The year stands in the header's switcher; a column is its quarter alone, as in the comp.
    label: year === undefined ? quarterLabelOf(key) : key.slice(-2),
    tone: QUARTER_TONES[key.slice(-1)] ?? 'accent',
  }));
}

function BoardSlot({
  item,
  state: cardsState,
  boardColumns,
  onEvent,
  timeZone,
  locale,
  dir,
  labels,
  addRefusal,
  onDismissAddRefusal,
  trackAdd,
  formatAmount,
  toolbarStates,
  statStates,
  person,
  onPersonChange,
  formatTotals,
  entityLabels,
  personLabel,
  today,
}: {
  today: string | undefined;
  formatAmount: PageBoardProps['formatAmount'];
  toolbarStates: BoardToolbarStates;
  /** The summary figures' answers, by the index `config.stats` names them with. */
  statStates: readonly (WidgetDataState | undefined)[];
  person: string | null;
  onPersonChange: PageBoardProps['onPersonChange'];
  formatTotals: PageBoardProps['formatTotals'];
  entityLabels: PageBoardProps['entityLabels'];
  personLabel: string | undefined;
  item: LayoutItem;
  state: WidgetDataState;
  boardColumns: BoardColumnsState | undefined;
  onEvent: PageBoardProps['onEvent'];
  timeZone: string | undefined;
  locale: string | undefined;
  dir: 'ltr' | 'rtl';
  labels: PageBoardLabels | undefined;
  /** An add that was refused, the composer's or a column's own: shown on the board. */
  addRefusal: BoardAddRefusal | null;
  onDismissAddRefusal: () => void;
  /** Follows an insert to its answer: a refusal becomes `addRefusal`. */
  trackAdd: TrackAdd;
}) {
  const t = useMaybeT();
  const raw = itemConfigOf(item);
  const cfg = useMemo(() => boardItemConfigOf(raw), [raw]);
  const source = planningSourceOf(raw);
  // The columns are another table's rows: there is no board until they are read too.
  const fromTable = cfg.columnsFrom !== undefined && boardColumns !== undefined;
  const state: WidgetDataState =
    !fromTable || cardsState.status !== 'success' || boardColumns.status === 'success'
      ? cardsState
      : boardColumns.status === 'loading'
        ? { status: 'loading' }
        : { status: 'error', error: boardColumns.error, ...(boardColumns.refetch === undefined ? {} : { refetch: boardColumns.refetch }) };
  const read = boardColumns?.status === 'success' ? boardColumns.columns : undefined;
  // The cards were read and the columns' table could not be: the error is of THAT table, and says so.
  const columnsFailed = fromTable && cardsState.status === 'success' && boardColumns.status === 'error';
  const rows = useMemo(() => boardRowsOf(state.data), [state.data]);
  const dateKind = planningDateKindOf(state.data, cfg.dateColumn);
  const answered = state.data as { key?: unknown } | null | undefined;
  const keyField = typeof answered?.key === 'string' ? answered.key : undefined;
  const language = useMaybeI18n()?.locale ?? locale;
  // The card's own facts, written from what the server answered: its names for the people in these rows, its count of days.
  const people = (state.data as { people?: unknown } | null | undefined)?.people;
  // The answer's words for a status and a lane, read in the reader's language.
  const served = useMemo(() => servedChoicesOf(state.data), [state.data]);
  const writer = useMemo<BoardCardWriter | undefined>(() => {
    if (Object.keys(cfg.card).length === 0) return undefined;
    const fmt = getFormatters(language ?? 'en-US');
    return {
      people: typeof people === 'object' && people !== null ? (people as Record<string, string>) : {},
      amount: (column, value) => formatAmount?.(column, value) ?? fmt.number(value, { maximumFractionDigits: 2 }),
      day: (column, value) => {
        // A day with no time is that day everywhere; an instant is the day it falls on where the board's dates are read.
        const day = splitInstant(value, { timeZone, kind: planningDateKindOf(state.data, column) })?.day;
        // The comp's due chip: "Sep 3", with the year only when it is not this one.
        return day === undefined || day === '' ? undefined : fmtMonthDay(language ?? 'en-US', day, new Date().getUTCFullYear());
      },
      days: (count) => t('ui:templates.board.days', '{count, plural, one {# day} other {# days}}', { count }),
      label: (label, labels) => pickLocalized(label, labels, language),
      daysLabelled: (days, label) => t('ui:templates.board.daysLabelled', '{days} {label}', { days, label }),
      secondAmount: (label, amount) => t('ui:templates.board.secondAmount', '{label} {amount}', { label, amount }),
      choice: (column, value) => ({ label: served.get(column)?.enumLabels?.[value], tone: served.get(column)?.enumTones?.[value] }),
    };
  }, [cfg.card, people, language, formatAmount, timeZone, state.data, t, served]);
  const cards = useMemo(
    () => boardCardsOf(rows, cfg, { timeZone, kind: dateKind }, keyField, writer),
    [rows, cfg, timeZone, dateKind, keyField, writer],
  );
  const roadmap = cfg.roadmap && cfg.dateColumn !== undefined;
  // A roadmap shows a year, the reader's own first; the header steps through the years.
  const thisYear = Number((today ?? todayIso(timeZone)).slice(0, 4));
  const [shownYear, setShownYear] = useState<number | null>(null);
  const year = shownYear ?? thisYear;
  const columns = useMemo(() => {
    if (roadmap) return quarterColumnsOf(cards, year);
    const words = served.get(cfg.statusColumn)?.enumLabels;
    const tones = served.get(cfg.statusColumn)?.enumTones;
    if (fromTable) return boardColumnDefsOf([], read ?? [], true);
    // A status with its own tones (the column's colours, set in Studio) heads its columns with them.
    const own = resolveColumns(cards, cfg.columnDefs, words).map((column) => (tones?.[column.id] === undefined ? column : { ...column, tone: boardToneOf(tones[column.id], column.tone) }));
    return read === undefined ? own : boardColumnDefsOf(own, read, false);
  }, [roadmap, cards, cfg.columnDefs, cfg.statusColumn, served, fromTable, read, year]);
  // What a drop writes: the column row's own key (a number, for most links), not the text it is matched by.
  const valueOf = (columnId: string): unknown => (fromTable ? (read?.find((row) => row.id === columnId)?.value ?? columnId) : columnId);
  // Cards with no status — or one outside the declared columns — are not on
  // any column. All of them unplaced reads as an empty board (a status column
  // just added to a table that has rows), so it gets a sentence. A roadmap
  // places by date and is not a repair target; it is left out.
  const placed = useMemo(
    () => cards.filter((card) => card.column !== '' && columns.some((column) => column.id === card.column)).length,
    [cards, columns],
  );
  const unplaced = cards.length - placed;
  const swimlane = item.widget === 'kanban-swimlane-grid';
  const lanes = useMemo(
    () =>
      swimlane
        ? resolveLanes(cards, cfg.laneDefs, cfg.laneColumn === undefined ? undefined : served.get(cfg.laneColumn)?.enumLabels)
        : [],
    [swimlane, cards, cfg.laneDefs, cfg.laneColumn, served],
  );

  const mutate = (recordId: string, values: Record<string, unknown>) => {
    if (source === null || onEvent === undefined) return undefined;
    return onEvent(item.i, {
      type: 'mutate',
      intent: 'update',
      connectionId: source.connectionId,
      table: source.table,
      recordId,
      values,
    });
  };

  const moveValues = (toColumn: string, toLane?: string): Record<string, unknown> => {
    if (roadmap) {
      const start = quarterStartIso(toColumn);
      return cfg.dateColumn !== undefined && start !== null
        ? { [cfg.dateColumn]: dayStartValue(start, { timeZone, kind: dateKind }) }
        : {};
    }
    const values: Record<string, unknown> = { [cfg.statusColumn]: valueOf(toColumn) };
    if (toLane !== undefined && cfg.laneColumn !== undefined) values[cfg.laneColumn] = toLane;
    if (cfg.progressColumn !== undefined && isCompletedColumn(toColumn)) values[cfg.progressColumn] = 100;
    return values;
  };

  const openCard = (cardId: string) => {
    if (source === null || onEvent === undefined) return;
    onEvent(item.i, {
      type: 'record-open',
      connectionId: source.connectionId,
      table: source.table,
      recordId: cardId,
    });
  };

  const frameState = state.status === 'loading' ? 'skeleton' : state.status === 'error' ? 'error' : 'loaded';
  /*
   * WHICH empty state. The widgets show theirs whenever they have nothing to
   * lay out — a plain board with no columns, a swimlane grid with no lanes —
   * and the host's text for it says "add a status field". That is right when
   * the table has rows the board cannot place, and wrong when the table simply
   * has no rows yet: lanes and data-derived columns come FROM the rows, so a
   * freshly installed app's board told its operator to add a status field it
   * already had. A board with its columns declared still shows them, empty and
   * addable; this only changes what the empty state SAYS.
   */
  const noRows = state.status === 'success' && rows.length === 0;
  // A board over a table with no rows has no columns, whatever cards there are: what it needs is a row there.
  const emptyTitle = fromTable
    ? t('ui:templates.board.noColumnsTitle', 'No columns yet')
    : noRows
      ? (labels?.noRowsTitle ?? t('ui:templates.board.noRowsTitle', 'No cards yet'))
      : labels?.emptyTitle;
  const emptyBody = fromTable
    ? t(
        'ui:templates.board.noColumnsBody',
        'This board takes its columns from the rows of a table, and that table has no rows yet. Add one and it appears here as a column.',
      )
    : noRows
      ? (labels?.noRowsBody ??
        t('ui:templates.board.noRowsBody', 'Cards appear here as soon as the table has rows.'))
      : labels?.emptyBody;
  // What one card is called, in a sentence ("New project"); the board's own words where the host named none.
  const one = entityLabels === undefined ? undefined : inSentence(entityLabels.one, language);
  const boardLabels = {
    ...(one === undefined
      ? labels?.addLabel === undefined
        ? {}
        : { addLabel: labels.addLabel }
      : { addLabel: t('ui:templates.board.addItem', 'Add {item}', { item: one }) }),
    ...(emptyTitle === undefined ? {} : { emptyTitle, emptyBody }),
    composePlaceholder:
      entityLabels === undefined
        ? (labels?.composePlaceholder ?? t('ui:widgets.boards.inlineComposeCard.placeholder', 'Card title…'))
        : t('ui:templates.board.itemName', '{item} name…', { item: entityLabels.one }),
    composeAdd: one === undefined ? (labels?.composeAdd ?? t('ui:widgets.boards.inlineComposeCard.addLabel', 'Add')) : t('ui:templates.board.addItem', 'Add {item}', { item: one }),
    ...(labels?.composeCancel === undefined ? {} : { composeCancel: labels.composeCancel }),
  };
  // "+" and "New …" type a card's name into its column: a board of quarters places by date and takes none.
  const canCompose = !roadmap && !swimlane && cfg.allowAdd && source !== null && onEvent !== undefined;
  const [composeRequest, setComposeRequest] = useState<{ column: string; at: number } | null>(null);
  const compose = (columnId: string, title: string) =>
    trackAdd(
      onEvent?.(item.i, {
        type: 'mutate',
        intent: 'insert',
        connectionId: source?.connectionId ?? '',
        table: source?.table ?? '',
        // A board of some of its rows: the card is given what puts it among them; then its column and its name.
        values: { ...onlyDefaultsOf(cfg.only), [cfg.statusColumn]: valueOf(columnId), [cfg.titleColumn]: title },
      }),
      title,
    );

  if (cfg.onlyInvalid) {
    // Not drawn at all: a board of every row, or one whose headers count other cards than it lists, would be read as the real one.
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-board-invalid-only">
        {t(
          'ui:templates.board.invalidOnly',
          'This board is set to show only some of its table’s rows, and that setting cannot be read, so the board is not drawn. Regenerate the page.',
        )}
      </p>
    );
  }

  const errorMessage =
    state.status !== 'error'
      ? undefined
      : columnsFailed
        ? [
            t('ui:templates.board.columnsError', 'This board’s columns could not be read from {table}.', { table: cfg.columnsFrom?.table ?? '' }),
            messageOf(state.error),
          ]
            .filter((part) => part !== undefined)
            .join(' ')
        : messageOf(state.error);

  // The toolbar is drawn OUTSIDE the cards' frame: narrowing the board to a person asks the cards again, and the
  // frame's skeleton must not take the filter away from under the pointer (or the keyboard's focus) meanwhile.
  const toolbarLine =
    cfg.toolbar === undefined ? null : (
      <BoardToolbarLine
        toolbar={cfg.toolbar}
        states={toolbarStates}
        figures={cfg.toolbarFigures}
        person={person}
        onPersonChange={onPersonChange}
        formatTotals={formatTotals}
        entityLabels={entityLabels}
        personLabel={personLabel}
        language={language}
        note={
          cfg.note === undefined ? null : (
            // On the toolbar's line, at its end (the comp): the page's own sentence about its board.
            <span data-testid="board-note" className="ms-auto flex items-center gap-[7px] rounded-[10px] border border-border bg-surface-2 px-[11px] py-1.5 text-caption text-fg-muted">
              <Columns3 aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
              {cfg.note.href === undefined || onEvent === undefined ? (
                <span>{pickLocalized(cfg.note.text, cfg.note.texts, language)}</span>
              ) : (
                <button
                  type="button"
                  className="rounded-sm text-start font-bold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onClick={() => void onEvent(item.i, { type: 'drill-through', href: cfg.note?.href ?? '' })}
                >
                  {pickLocalized(cfg.note.text, cfg.note.texts, language)}
                </button>
              )}
            </span>
          )
        }
      />
    );
  const framed = (
    <WidgetFrame
      state={frameState}
      frameless
      skeleton="block"
      errorMessage={errorMessage}
      onRetry={state.refetch}
      refetching={state.isRefetching === true}
      testId={`board-slot-${item.i}`}
    >
      {/* A column, so the notice takes its height FROM the board: the board is
          `h-full`, and as a plain sibling below the notice it overflowed the
          slot by the notice's height, into the composer placed under it. */}
      <div className="flex h-full min-h-0 flex-col">
        {cfg.note === undefined || cfg.toolbar !== undefined ? null : (
          // The page's own sentence about its board ("Columns come from Stages"), in the reader's language.
          <p data-testid="board-note" className="px-3 pt-2 text-caption text-fg-muted">
            {cfg.note.href === undefined || onEvent === undefined ? (
              pickLocalized(cfg.note.text, cfg.note.texts, language)
            ) : (
              <button
                type="button"
                className="rounded-sm text-start underline decoration-dotted underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={() => void onEvent(item.i, { type: 'drill-through', href: cfg.note?.href ?? '' })}
              >
                {pickLocalized(cfg.note.text, cfg.note.texts, language)}
              </button>
            )}
          </p>
        )}
        {state.status === 'success' && fromTable && columns.length > 0 && placed > 0 && unplaced > 0 ? (
          // Some cards are on the board and some are on no column: a stage row
          // that was deleted, one past the columns that are read, or no stage
          // at all. They are not drawn, so the board says how many there are.
          <UnplacedRowsNotice
            testId="board-unplaced-rows"
            message={t(
              'ui:templates.planning.unplaced.boardColumnsSome',
              '{count, plural, one {# row is in none of the board’s columns, so it is not shown here.} other {# rows are in none of the board’s columns, so they are not shown here.}}',
              { count: unplaced },
            )}
          />
        ) : null}
        {state.status === 'success' && fromTable && boardColumns.more === true && columns.length > 0 ? (
          // The columns' table has more rows than a board draws: said, so a stage past the last one is not just missing.
          <UnplacedRowsNotice
            testId="board-columns-cut"
            message={t(
              'ui:templates.board.columnsCut',
              '{count, plural, one {Showing the first column only: the table this board takes its columns from has more rows.} other {Showing the first # columns: the table this board takes its columns from has more rows.}}',
              { count: columns.length },
            )}
          />
        ) : null}
        {state.status === 'success' && !roadmap && !(fromTable && columns.length === 0) && nothingPlaced(rows.length, placed) ? (
          <UnplacedRowsNotice
            testId="board-unplaced-rows"
            message={
              fromTable
                ? t(
                    'ui:templates.planning.unplaced.boardColumns',
                    'None of this table’s rows is in one of the board’s columns yet, so the board is empty. A row appears here as soon as it is put in one.',
                  )
                : t(
                    'ui:templates.planning.unplaced.board',
                    'None of this table’s rows has a status yet, so the board is empty. A row appears here as soon as it has one.',
                  )
            }
          />
        ) : null}
        <div className="min-h-0 flex-1">
          {swimlane ? (
            <KanbanSwimlaneGrid
              cards={cards}
              columns={columns}
              lanes={lanes}
              dir={dir}
              {...(locale === undefined ? {} : { locale })}
              labels={boardLabels}
              onCardMove={(cardId, _from, to) => mutate(cardId, moveValues(to.column, to.lane))}
              onCardOpen={openCard}
              addRefusal={addRefusal}
              onDismissAddRefusal={onDismissAddRefusal}
            />
          ) : (
            <KanbanBoard
              cards={cards}
              columns={columns}
              dir={dir}
              {...(locale === undefined ? {} : { locale })}
              allowAdd={!roadmap && cfg.allowAdd}
              roadmapCards={roadmap}
              labels={boardLabels}
              {...(canCompose ? { onCompose: compose, composeRequest } : {})}
              onCardMove={(cardId, _from, toColumn) => mutate(cardId, moveValues(toColumn))}
              onCardOpen={openCard}
              addRefusal={addRefusal}
              onDismissAddRefusal={onDismissAddRefusal}
              onAdd={(columnId) => {
                if (source === null || onEvent === undefined) return;
                // Followed to its answer: a refused insert is said on the board (`addRefusal`), never dropped.
                trackAdd(
                  onEvent(item.i, {
                    type: 'mutate',
                    intent: 'insert',
                    connectionId: source.connectionId,
                    table: source.table,
                    // A board of some of its rows: the card is given what puts it among them.
                    values: { ...onlyDefaultsOf(cfg.only), [cfg.statusColumn]: valueOf(columnId) },
                  }),
                ).catch(() => undefined);
              }}
            />
          )}
        </div>
      </div>
    </WidgetFrame>
  );
  const newButton =
    !canCompose || columns.length === 0 ? null : (
      // The comp's header button: a new card, typed into the board's first column.
      <button
        type="button"
        data-testid="board-new"
        onClick={() => setComposeRequest({ column: columns[0]?.id ?? '', at: Date.now() })}
        className="ms-auto flex shrink-0 items-center gap-[7px] rounded-[10px] bg-accent py-2 pe-[13px] ps-2.5 text-[13px] font-bold leading-[normal] text-accent-fg shadow-[0_2px_8px_color-mix(in_srgb,var(--accent)_35%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Plus aria-hidden="true" className="size-4" />
        {one === undefined ? t('ui:templates.board.newCard', 'New card') : t('ui:templates.board.newItem', 'New {item}', { item: one })}
      </button>
    );
  const stats =
    cfg.stats.length === 0 || roadmap ? null : (
      <BoardStats
        stats={cfg.stats}
        states={statStates}
        columnLabel={(value) => columns.find((column) => column.id === value)?.label ?? served.get(cfg.statusColumn)?.enumLabels?.[value] ?? value}
        formatAmount={formatAmount}
        language={language}
      />
    );
  const step = 'flex size-8 items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';
  const yearNav = !roadmap ? null : (
    <div role="group" aria-label={t('ui:templates.board.roadmapYear', 'Roadmap year')} data-testid="roadmap-year" className="flex items-center gap-2">
      <button type="button" className={step} aria-label={t('ui:templates.board.previousYear', 'Previous year')} onClick={() => setShownYear(year - 1)}>
        <ChevronLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      </button>
      <span aria-live="polite" className="min-w-12 text-center font-mono text-[15px] font-semibold tabular-nums text-fg">
        {String(year)}
      </span>
      <button type="button" className={step} aria-label={t('ui:templates.board.nextYear', 'Next year')} onClick={() => setShownYear(year + 1)}>
        <ChevronRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      </button>
      {year === thisYear ? null : (
        <button type="button" onClick={() => setShownYear(null)} className="rounded-[9px] border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
          {t('ui:templates.board.thisYear', 'This year')}
        </button>
      )}
    </div>
  );
  if (toolbarLine === null && newButton === null && stats === null && yearNav === null) return framed;
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      {toolbarLine === null && newButton === null && yearNav === null ? null : (
        <div className="flex items-center gap-3">
          {toolbarLine === null ? null : <div className="min-w-0 flex-1">{toolbarLine}</div>}
          {yearNav}
          {newButton}
        </div>
      )}
      {stats}
      <div className="min-h-0 flex-1">{framed}</div>
    </div>
  );
}

function ComposeSlot({
  item,
  board,
  boardColumns,
  onEvent,
  labels,
  trackAdd,
}: {
  item: LayoutItem;
  /** The board item the composer inserts into (defaults ride its config). */
  board: LayoutItem | undefined;
  boardColumns: BoardColumnsState | undefined;
  onEvent: PageBoardProps['onEvent'];
  labels: PageBoardLabels | undefined;
  trackAdd: TrackAdd;
}) {
  const raw = itemConfigOf(item);
  const boardRaw = board === undefined ? {} : itemConfigOf(board);
  const boardCfg = boardItemConfigOf(boardRaw);
  // Insert target: the composer's own binding, else the board's.
  const source = planningSourceOf(raw) ?? planningSourceOf(boardRaw);
  const titleField = configString(raw, 'titleField', 'titleColumn') ?? boardCfg.titleColumn;
  const defaults = (typeof raw['defaults'] === 'object' && raw['defaults'] !== null ? raw['defaults'] : {}) as Record<
    string,
    unknown
  >;
  // A new card starts in the board's first column: the first row of the columns' table, by its own key.
  const firstRow = boardCfg.columnsFrom === undefined ? undefined : boardColumns?.columns?.[0];
  const firstColumn: unknown = boardCfg.columnsFrom === undefined ? boardCfg.columnDefs?.[0]?.id : (firstRow?.value ?? firstRow?.id);
  // The columns are another table's rows, and they are not there (still being
  // read, could not be read, or none yet): a card added now would be in no
  // column, and so on no board. Nothing is added until there is one to be in.
  // A board that is not drawn (its `only` cannot be read) takes no card either: what would put one on it is not known.
  const noColumnYet = boardCfg.onlyInvalid || (boardCfg.columnsFrom !== undefined && boardColumns !== undefined && firstRow === undefined);

  return (
    <InlineComposeCard
      defaultOpen={raw['defaultOpen'] === true}
      keepOpen={raw['keepOpen'] !== false}
      {...(labels?.composePlaceholder === undefined ? {} : { placeholder: labels.composePlaceholder })}
      {...(labels?.composeAdd === undefined ? {} : { addLabel: labels.composeAdd })}
      {...(labels?.composeCancel === undefined ? {} : { cancelLabel: labels.composeCancel })}
      testId={`compose-slot-${item.i}`}
      disabled={noColumnYet}
      onAdd={(title) => {
        if (source === null || onEvent === undefined || noColumnYet) return undefined;
        // Handed back, followed to its answer: the composer keeps the typed title until the insert holds, and a
        // refusal is said on the board (`addRefusal`).
        return trackAdd(
          onEvent(item.i, {
            type: 'mutate',
            intent: 'insert',
            connectionId: source.connectionId,
            table: source.table,
            // The composer's stored defaults FIRST (annex): what puts the card on this board — the column it starts
            // in and each single value of `only` — and the typed title are written after them, so a default left in
            // a stored config can clobber none of the three. A card added with another value would be on no board.
            values: {
              ...defaults,
              ...onlyDefaultsOf(boardCfg.only),
              ...(firstColumn === undefined ? {} : { [boardCfg.statusColumn]: boardCfg.columnsFrom === undefined ? String(firstColumn) : firstColumn }),
              [titleField]: title,
            },
          }),
          title,
        );
      }}
    />
  );
}

/** Follows an insert to its answer; rejects as the insert did, so whoever asked can keep what was typed. */
type TrackAdd = (result: void | Promise<unknown>, title?: string) => Promise<unknown>;

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return undefined;
}

export function PageBoard({
  config,
  boardColumns,
  states,
  onEvent,
  timeZone,
  today,
  locale,
  dir = 'ltr',
  labels,
  className,
  testId,
  currency,
  formatAmount,
  person = null,
  onPersonChange,
  formatTotals,
  entityLabels,
  personLabel,
}: PageBoardProps) {
  const t = useMaybeT();
  const parsed = useMemo(() => parseTemplateConfig(config), [config]);
  const resolvedStates = useTemplateStates(parsed.layout, states);
  const boardItem = parsed.layout.items.find((item) => BOARD_WIDGET_IDS.has(item.widget));
  // A card that was not added, the composer's or a column's own button's: said on the board until dismissed or the next add.
  const [addRefusal, setAddRefusal] = useState<BoardAddRefusal | null>(null);
  const trackAdd = useCallback<TrackAdd>((result, title) => {
    setAddRefusal(null);
    return Promise.resolve(result).then(undefined, (error: unknown) => {
      setAddRefusal({ title, reason: refusalReasonOf(error) });
      throw error;
    });
  }, []);
  const dismissAddRefusal = useCallback(() => setAddRefusal(null), []);

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-board-invalid">
        {t(
          'ui:templates.board.invalidLayout',
          'This board’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  return (
    <DashboardGrid
      layout={parsed.layout}
      className={className}
      testId={testId ?? 'page-board'}
      renderItem={(item) => {
        const state = resolvedStates[item.i] ?? { status: 'loading' as const };
        if (BOARD_WIDGET_IDS.has(item.widget)) {
          return (
            <BoardSlot
              item={item}
              state={state}
              boardColumns={boardColumns}
              onEvent={onEvent}
              timeZone={timeZone}
              today={today}
              locale={locale}
              dir={dir}
              labels={labels}
              addRefusal={addRefusal}
              onDismissAddRefusal={dismissAddRefusal}
              trackAdd={trackAdd}
              formatAmount={formatAmount}
              // The toolbar's own queries, by the board item's id: never a widget of the grid's.
              toolbarStates={{
                figures: Array.from({ length: Array.isArray(item.config['toolbarBindings']) ? (item.config['toolbarBindings'] as unknown[]).length : 0 }, (_, index) => states?.[boardToolbarInstanceId(item.i, index)]),
                people: states?.[boardPeopleInstanceId(item.i)],
              }}
              statStates={Array.from({ length: Array.isArray(item.config['statBindings']) ? (item.config['statBindings'] as unknown[]).length : 0 }, (_, index) => states?.[boardStatInstanceId(item.i, index)])}
              person={person}
              onPersonChange={onPersonChange}
              formatTotals={formatTotals}
              entityLabels={entityLabels}
              personLabel={personLabel}
            />
          );
        }
        if (item.widget === COMPOSE_WIDGET_ID) {
          return <ComposeSlot item={item} board={boardItem} boardColumns={boardColumns} onEvent={onEvent} labels={labels} trackAdd={trackAdd} />;
        }
        return (
          <WidgetHost
            widgetId={item.widget}
            instanceId={item.i}
            config={withCurrency(item.config, currency)}
            data={state}
            onEvent={onEvent === undefined ? undefined : (event) => void onEvent(item.i, event)}
          />
        );
      }}
    />
  );
}
