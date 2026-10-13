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

import type { BoardColumns, BoardOnly, BoardTotalFn, CandidateTableInput } from '@adminium/widgets/generate';

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);

/** Why `entry` cannot be the board `board` describes, or null. */
export function boardColumnsProblem(
  entry: CandidateTableInput,
  board: BoardColumns,
  model: readonly CandidateTableInput[],
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
    for (const name of [from.label, from.order]) {
      if (name !== undefined && !source.columns.some((candidate) => candidate.name === name)) return `${source.name} has no column ${name} for the board's columns`;
    }
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
    ...(table === undefined || label === undefined ? {} : { columnsFrom: { table: tableId(table) ?? table, label, ...(order === undefined ? {} : { order }) } }),
    ...(title === undefined ? {} : { title }),
    ...(totals.length === 0 ? {} : { totals }),
  };
}
