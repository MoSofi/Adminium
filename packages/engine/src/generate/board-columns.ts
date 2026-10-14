// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The columns a board page is drawn with, when somebody names them.
 *
 * Left to itself the board rule takes the table's workflow enum, so a board's
 * columns were a fixed list and a table with no such enum had no board at
 * all. An app names them instead, in its page's `config.board`: the rows of a
 * table its cards link to (`columnsFrom`) — a sales team's own stages, which
 * it can add to — or the values of an enum it picks.
 *
 * The candidate rule that draws the board is the widgets package's
 * (`boards.named-columns`); this only says, in a sentence, why a table cannot
 * carry the board it was asked for, where the rule would say nothing.
 */

import type { BoardBadge, BoardCardFacts, BoardColumns, BoardNote, BoardOnly, BoardTotalFn, CandidateTableInput } from '@adminium/widgets/generate';
import { measureTestProblem } from '@adminium/widgets/page-config';

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);
const DAY_TYPES: ReadonlySet<string> = new Set(['date', 'timestamp', 'timestamptz']);

/** Why `entry` cannot be the board `board` describes, or null. */
export function boardColumnsProblem(
  entry: CandidateTableInput,
  board: BoardColumns,
  model: readonly CandidateTableInput[],
  /** The database's engine, where it is known: Postgres holds a whole number to its column's width. */
  dialect?: string | undefined,
): string | null {
  const columns = new Map(entry.table.columns.map((column) => [column.name, column]));
  const table = entry.table.name;
  const column = columns.get(board.column);
  if (column === undefined) return `${table} has no column ${board.column} to place the board's cards by`;
  const from = board.columnsFrom;
  if (from === undefined) {
    if ((column.enumValues ?? []).length === 0) return `${table}.${board.column} is not an enum, so the board has no columns to take from it`;
  } else {
    const source = model.find((candidate) => candidate.table.id === from.table)?.table;
    if (source === undefined) return `${from.table} is not a table the board can take its columns from`;
    if (column.references == null || column.references.tableId !== from.table) return `${table}.${board.column} is not a link to ${source.name}`;
    for (const name of [from.label, from.order, from.badge?.column]) {
      if (name !== undefined && !source.columns.some((candidate) => candidate.name === name)) return `${source.name} has no column ${name} for the board's columns`;
    }
  }
  // What a card shows, each against the REAL column: a board that would draw a blank where it was told to draw a name is not built.
  const card = board.card ?? {};
  if (card.link !== undefined) {
    const [via, shown] = card.link.split('.') as [string, string | undefined];
    const link = columns.get(via);
    const target = link?.references == null ? undefined : model.find((candidate) => candidate.table.id === link.references?.tableId)?.table;
    if (link === undefined) return `${table} has no column ${via} for a card to read a name through`;
    if (target === undefined) return `${table}.${via} is not a link, so a card has no row to read ${shown ?? 'a name'} from`;
    if (!target.columns.some((candidate) => candidate.name === shown)) return `${target.name} has no column ${shown ?? ''} for a card`;
  }
  // Whether it holds a staff member is the manifest's own check (`rules.staff`) and the server's at every read: a model does not say.
  if (card.person !== undefined && !columns.has(card.person)) return `${table} has no column ${card.person} for a card's person`;
  if (card.amount !== undefined) {
    const amount = columns.get(card.amount);
    if (amount === undefined) return `${table} has no column ${card.amount} for a card's amount`;
    if (!NUMERIC_TYPES.has(amount.logicalType)) return `${table}.${card.amount} is not a number, so a card cannot show it as an amount`;
  }
  for (const name of [card.daysSince?.column, card.date]) {
    if (name === undefined) continue;
    const day = columns.get(name);
    if (day === undefined) return `${table} has no column ${name} for a card's date`;
    if (!DAY_TYPES.has(day.logicalType)) return `${table}.${name} is not a date or a time, so a card cannot read a day from it`;
  }
  if (board.title !== undefined && !columns.has(board.title)) return `${table} has no column ${board.title} for a card's title`;
  for (const total of board.totals ?? []) {
    const summed = columns.get(total.column);
    if (summed === undefined) return `${table} has no column ${total.column} to total`;
    if (!NUMERIC_TYPES.has(summed.logicalType)) return `${table}.${total.column} is not a number, so the board cannot total it`;
  }
  // Said here, where the rule would only say nothing: a board whose `only` cannot be asked is no board, never one of every row.
  for (const test of board.only ?? []) {
    if (!columns.has(test.column)) return `${table} has no column ${test.column} to choose the board's cards by`;
    if (test.in.length === 0) return `${table}.${test.column} is given no value to choose the board's cards by`;
    if (test.column === board.column) return `${table}.${test.column} is what the board's columns are, so it cannot also choose its cards`;
    /*
     * Each value against the REAL column, by the table the server reads when
     * it binds the test (`measureTestProblem`). A value the column cannot be
     * compared with — text on a link keyed by a whole number — would install
     * and then make every read of the board's columns a refusal.
     */
    const tested = columns.get(test.column) as NonNullable<ReturnType<typeof columns.get>>;
    const native = (tested as { dbType?: unknown }).dbType;
    const shape = { logicalType: tested.logicalType, isArray: tested.isArray, ...(typeof native === 'string' ? { dbType: native } : {}) };
    const takes = measureTestProblem(shape, test.in, dialect);
    if (takes !== null) {
      // The first value that is the trouble, so the sentence names it.
      const culprit = test.in.find((value) => measureTestProblem(shape, [value], dialect) !== null) ?? test.in[0];
      return takes.startsWith('no test')
        ? `${table}.${test.column} cannot choose the board's cards: ${takes.slice('no test: '.length)}`
        : `${table}.${test.column} takes ${takes}, so ${JSON.stringify(culprit)} cannot choose the board's cards`;
    }
  }
  return null;
}

/**
 * A page's `config.board` as the composition takes it, or null when the page
 * names no board. `tableId` turns the name the page writes for the columns'
 * table (an app's short name) into that table's id in the model; a table it
 * does not know is left as written, and the composition then says so.
 *
 * It only reads: the manifest's own check has judged the names.
 */
export function boardColumnsOf(raw: unknown, tableId: (name: string) => string | undefined): BoardColumns | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const text = (from: Record<string, unknown>, key: string): string | undefined => (typeof from[key] === 'string' && from[key] !== '' ? (from[key] as string) : undefined);
  const column = text(value, 'column');
  if (column === undefined) return null;
  const from = typeof value['columnsFrom'] === 'object' && value['columnsFrom'] !== null ? (value['columnsFrom'] as Record<string, unknown>) : null;
  const [table, label, order] = from === null ? [] : [text(from, 'table'), text(from, 'label'), text(from, 'order')];
  const doc = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
  const days = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined);
  const rawBadge = from === null ? null : doc(from['badge']);
  const badgeColumn = rawBadge === null ? undefined : text(rawBadge, 'column');
  const badgeAs = rawBadge?.['as'];
  const badge: BoardBadge | undefined = badgeColumn === undefined ? undefined : { column: badgeColumn, ...(badgeAs === 'text' || badgeAs === 'number' || badgeAs === 'percent' ? { as: badgeAs } : {}) };
  const rawCard = doc(value['card']);
  const rawDays = rawCard === null ? null : doc(rawCard['daysSince']);
  const daysColumn = rawDays === null ? undefined : text(rawDays, 'column');
  const [warnFrom, alertFrom] = rawDays === null ? [] : [days(rawDays['warnFrom']), days(rawDays['alertFrom'])];
  const card: BoardCardFacts =
    rawCard === null
      ? {}
      : {
          ...(text(rawCard, 'link') === undefined ? {} : { link: text(rawCard, 'link') }),
          ...(text(rawCard, 'person') === undefined ? {} : { person: text(rawCard, 'person') }),
          ...(text(rawCard, 'amount') === undefined ? {} : { amount: text(rawCard, 'amount') }),
          ...(daysColumn === undefined ? {} : { daysSince: { column: daysColumn, ...(warnFrom === undefined ? {} : { warnFrom }), ...(alertFrom === undefined ? {} : { alertFrom }) } }),
          ...(text(rawCard, 'date') === undefined ? {} : { date: text(rawCard, 'date') }),
        };
  const rawNote = doc(value['note']);
  const noteText = rawNote === null ? undefined : text(rawNote, 'text');
  const texts = rawNote === null ? null : doc(rawNote['texts']);
  const note: BoardNote | undefined =
    rawNote === null || noteText === undefined
      ? undefined
      : {
          text: noteText,
          ...(texts === null ? {} : { texts: Object.fromEntries(Object.entries(texts).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')) }),
          ...(text(rawNote, 'href') === undefined ? {} : { href: text(rawNote, 'href') }),
        };
  const title = text(value, 'title');
  const totals = (Array.isArray(value['totals']) ? (value['totals'] as unknown[]) : []).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const total = entry as Record<string, unknown>;
    const name = text(total, 'column');
    const fn = total['fn'];
    return name === undefined || (fn !== 'sum' && fn !== 'avg') ? [] : [{ column: name, fn: fn as BoardTotalFn }];
  });
  // `only` as the manifest writes it (`{ state: 'open', kind: ['new', 'renewal'] }`), one test a column.
  const written = typeof value['only'] === 'object' && value['only'] !== null && !Array.isArray(value['only']) ? (value['only'] as Record<string, unknown>) : {};
  const only: BoardOnly[] = Object.entries(written).flatMap(([name, listed]) => {
    const values = (Array.isArray(listed) ? (listed as unknown[]) : [listed]).filter(
      (entry): entry is string | number | boolean => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
    );
    // A test with no value left is kept, empty: the composition then refuses the board rather than draw every row.
    return name === '' ? [] : [{ column: name, in: values }];
  });
  return {
    column,
    ...(only.length === 0 ? {} : { only }),
    ...(table === undefined || label === undefined ? {} : { columnsFrom: { table: tableId(table) ?? table, label, ...(order === undefined ? {} : { order }), ...(badge === undefined ? {} : { badge }) } }),
    ...(Object.keys(card).length === 0 ? {} : { card }),
    ...(note === undefined ? {} : { note }),
    ...(title === undefined ? {} : { title }),
    ...(totals.length === 0 ? {} : { totals }),
  };
}
