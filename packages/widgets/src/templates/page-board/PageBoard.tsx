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
import { useCallback, useMemo, useState } from 'react';

import { KanbanBoard } from '../../families/boards/KanbanBoard.js';
import { KanbanSwimlaneGrid } from '../../families/boards/KanbanSwimlaneGrid.js';
import { InlineComposeCard } from '../../families/boards/InlineComposeCard.js';
import { refusalReasonOf, type BoardAddRefusal } from '../../families/boards/board-dnd.js';
import {
  boardRowsOf,
  resolveColumns,
  resolveLanes,
  toBoardCard,
  type BoardCardData,
  type ColumnDef,
  type ColumnDefInput,
  type LaneDefInput,
} from '../../families/boards/board-lib.js';
import { servedChoicesOf } from '../../families/tables/choices.js';
import { BOARD_CARD_DAYS_ALIAS, BOARD_CARD_LINK_ALIAS, type BoardBadge, type BoardCardFacts, type BoardNote } from '../../registry/board-facts.js';
import { WidgetFrame } from '../../frame/WidgetFrame.js';
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

/** The stored `card`: each piece that names a column, and nothing it cannot read. */
function cardFactsOf(config: Record<string, unknown>): BoardCardFacts {
  const raw = config['card'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const card = raw as Record<string, unknown>;
  const rawDays = typeof card['daysSince'] === 'object' && card['daysSince'] !== null ? (card['daysSince'] as Record<string, unknown>) : undefined;
  const daysColumn = rawDays === undefined ? undefined : configString(rawDays, 'column');
  const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined);
  const link = configString(card, 'link');
  return {
    ...(link === undefined || !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(link) ? {} : { link }),
    ...(configString(card, 'person') === undefined ? {} : { person: configString(card, 'person') }),
    ...(configString(card, 'amount') === undefined ? {} : { amount: configString(card, 'amount') }),
    ...(daysColumn === undefined ? {} : { daysSince: { column: daysColumn, warnFrom: whole(rawDays?.['warnFrom']), alertFrom: whole(rawDays?.['alertFrom']) } }),
    ...(configString(card, 'date') === undefined ? {} : { date: configString(card, 'date') }),
  };
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
  if (asked.amount !== undefined) {
    const raw = row[asked.amount];
    const amount = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
    card.budget = Number.isFinite(amount) ? facts.amount(asked.amount, amount) : undefined;
  }
  if (asked.daysSince !== undefined) {
    const count = row[BOARD_CARD_DAYS_ALIAS];
    if (typeof count === 'number' && Number.isFinite(count)) {
      card.tag = facts.days(count);
      card.tagTone = asked.daysSince.alertFrom !== undefined && count >= asked.daysSince.alertFrom ? 'danger' : asked.daysSince.warnFrom !== undefined && count >= asked.daysSince.warnFrom ? 'warn' : 'neutral';
    } else {
      card.tag = undefined;
    }
  }
  if (asked.date !== undefined) card.due = facts.day(asked.date, row[asked.date]);
}

/** Roadmap columns: the distinct quarters present, chronologically. */
export function quarterColumnsOf(cards: readonly BoardCardData[]): ColumnDef[] {
  const keys = [...new Set(cards.map((card) => card.column).filter((key) => key !== ''))].sort();
  const tones: ColumnDef['tone'][] = ['accent', 'info', 'warn', 'pos'];
  return keys.map((key, index) => ({
    id: key,
    label: quarterLabelOf(key),
    tone: tones[index % tones.length] as ColumnDef['tone'],
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
}: {
  formatAmount: PageBoardProps['formatAmount'];
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
  const writer = useMemo<BoardCardWriter | undefined>(() => {
    if (Object.keys(cfg.card).length === 0) return undefined;
    const fmt = getFormatters(language ?? 'en-US');
    return {
      people: typeof people === 'object' && people !== null ? (people as Record<string, string>) : {},
      amount: (column, value) => formatAmount?.(column, value) ?? fmt.number(value, { maximumFractionDigits: 2 }),
      day: (column, value) => {
        // A day with no time is that day everywhere; an instant is the day it falls on where the board's dates are read.
        const day = splitInstant(value, { timeZone, kind: planningDateKindOf(state.data, column) })?.day;
        return day === undefined || day === '' ? undefined : fmt.date(`${day}T12:00:00Z`, 'medium', { timeZone: 'UTC' });
      },
      days: (count) => t('ui:templates.board.days', '{count, plural, one {# day} other {# days}}', { count }),
    };
  }, [cfg.card, people, language, formatAmount, timeZone, state.data, t]);
  const cards = useMemo(
    () => boardCardsOf(rows, cfg, { timeZone, kind: dateKind }, keyField, writer),
    [rows, cfg, timeZone, dateKind, keyField, writer],
  );
  const roadmap = cfg.roadmap && cfg.dateColumn !== undefined;
  // The answer's words for a status and a lane, read in the reader's language.
  const served = useMemo(() => servedChoicesOf(state.data), [state.data]);
  const columns = useMemo(() => {
    if (roadmap) return quarterColumnsOf(cards);
    const words = served.get(cfg.statusColumn)?.enumLabels;
    if (fromTable) return boardColumnDefsOf([], read ?? [], true);
    const own = resolveColumns(cards, cfg.columnDefs, words);
    return read === undefined ? own : boardColumnDefsOf(own, read, false);
  }, [roadmap, cards, cfg.columnDefs, cfg.statusColumn, served, fromTable, read]);
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
  const boardLabels = {
    ...(labels?.addLabel === undefined ? {} : { addLabel: labels.addLabel }),
    ...(emptyTitle === undefined ? {} : { emptyTitle, emptyBody }),
  };

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

  return (
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
        {cfg.note === undefined ? null : (
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
              labels={boardLabels}
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
  locale,
  dir = 'ltr',
  labels,
  className,
  testId,
  currency,
  formatAmount,
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
              locale={locale}
              dir={dir}
              labels={labels}
              addRefusal={addRefusal}
              onDismissAddRefusal={dismissAddRefusal}
              trackAdd={trackAdd}
              formatAmount={formatAmount}
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
