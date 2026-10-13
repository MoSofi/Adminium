// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A board page's columns: `config.board` on a `page-board` page.
 *
 * Left to itself Adminium draws a board over the workflow enum it finds on the
 * table, so a board's columns were a fixed list written into the app: a sales
 * team could not add a stage of its own. An app says what the columns are
 * instead:
 *
 * ```json
 * "config": { "board": {
 *   "column": "stage_id",
 *   "columnsFrom": { "table": "crm_stages", "label": "name", "order": "position" },
 *   "title": "name",
 *   "totals": [{ "column": "amount", "fn": "sum" }],
 *   "only": { "state": "open" }
 * } }
 * ```
 *
 *  - `column` (required): the column of the page's table a card is placed by.
 *    With `columnsFrom` it is a link to that table; without, an enum column,
 *    and the board's columns are the enum's values;
 *  - `columnsFrom`: the table whose rows are the board's columns — every row,
 *    a row with no card too — headed by its `label` column and ordered by its
 *    `order` column (left out: by its key);
 *  - `title`: the column of the page's table a card is titled with;
 *  - `totals` (at most two): a number or money column of the page's table,
 *    summed or averaged over each column's cards and shown in its header;
 *  - `only` (one to three columns): which cards are on the board — a card is
 *    one when each column named holds its value, or one of its values. Both
 *    the cards listed and each header's count and totals are of those cards.
 *
 * Every name is the app's own (a column ref), checked here against
 * `requiredSchema`, so an app's CI refuses a typo long before an install.
 */
import { z } from 'zod';

import { NUMERIC_TYPES, refSchema, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.js';

/** How a header's figure is worked out of its cards. */
export const PAGE_BOARD_TOTAL_FNS = ['sum', 'avg'] as const;

/** The most figures a column's header shows beside its count. */
export const PAGE_BOARD_TOTALS_MAX = 2;

/** The most columns `only` tests, and the most values one of them lists. */
export const PAGE_BOARD_ONLY_MAX = 3;
export const PAGE_BOARD_ONLY_VALUES_MAX = 20;

/** Column types `only` compares: a choice, a yes/no, a link, text, a whole number. */
export const PAGE_BOARD_ONLY_TYPES: readonly string[] = ['enum', 'bool', 'fk', 'text', 'int', 'bigint'];

const onlyValueSchema = z.union([z.string().min(1).max(200), z.number().finite(), z.boolean()]);

export const pageBoardOnlySchema = z
  .record(refSchema, z.union([onlyValueSchema, z.array(onlyValueSchema).min(1).max(PAGE_BOARD_ONLY_VALUES_MAX)]))
  .refine((only) => Object.keys(only).length >= 1 && Object.keys(only).length <= PAGE_BOARD_ONLY_MAX, {
    message: `only names one to ${String(PAGE_BOARD_ONLY_MAX)} columns`,
  });

/** One `only` entry's values as a list, whichever way it was written. */
export function pageBoardOnlyValues(value: z.infer<typeof onlyValueSchema> | z.infer<typeof onlyValueSchema>[]): (string | number | boolean)[] {
  return Array.isArray(value) ? value : [value];
}

export const pageBoardSchema = z
  .object({
    column: refSchema,
    columnsFrom: z.object({ table: refSchema, label: refSchema, order: refSchema.optional() }).strict().optional(),
    title: refSchema.optional(),
    totals: z
      .array(z.object({ column: refSchema, fn: z.enum(PAGE_BOARD_TOTAL_FNS) }).strict())
      .min(1)
      .max(PAGE_BOARD_TOTALS_MAX)
      .optional(),
    only: pageBoardOnlySchema.optional(),
  })
  .strict();
export type PageBoard = z.infer<typeof pageBoardSchema>;

/** What the check reads of a page. */
interface PageShape {
  template: string;
  bindings?: Readonly<Record<string, string>> | undefined;
  config?: Readonly<Record<string, unknown>> | undefined;
}

/** The table a page reads: its one binding, or the one keyed `rows`. */
function pageTable(page: PageShape): string | undefined {
  const entries = Object.values(page.bindings ?? {});
  return entries.length === 1 ? entries[0] : page.bindings?.['rows'];
}

/** Every problem with the pages' `config.board`, against the app's own tables. */
export function pageBoardIssues<C extends ColumnShape>(pages: readonly PageShape[], index: TableIndex<C>): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  pages.forEach((page, p) => {
    const raw = page.config?.['board'];
    if (raw === undefined) return;
    const at = (...rest: (string | number)[]) => ['pages', p, 'config', 'board', ...rest];
    const parsed = pageBoardSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) out.push({ path: at(...issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key))), message: issue.message });
      return;
    }
    if (page.template !== 'page-board') {
      out.push({ path: at(), message: `only a page-board takes its columns from config.board, not a ${page.template}` });
      return;
    }
    const table = pageTable(page);
    if (table === undefined || index.table(table) === undefined) {
      out.push({ path: at(), message: 'a board names its columns on a page bound to a table of the app' });
      return;
    }
    const board = parsed.data;
    const column = index.column(table, board.column);
    const from = board.columnsFrom;
    if (column === undefined) out.push({ path: at('column'), message: `"${table}" has no column "${board.column}"` });
    else if (from === undefined) {
      if (column.type !== 'enum') out.push({ path: at('column'), message: `"${table}.${board.column}" is not an enum: name the table its columns come from in columnsFrom, or place cards by an enum column` });
    } else if (column.type !== 'fk' || column.references !== from.table) {
      out.push({ path: at('column'), message: `"${table}.${board.column}" is not a link to "${from.table}"` });
    }
    if (from !== undefined) {
      if (index.table(from.table) === undefined) out.push({ path: at('columnsFrom', 'table'), message: `the app has no table "${from.table}"` });
      else {
        for (const key of ['label', 'order'] as const) {
          const name = from[key];
          if (name !== undefined && !index.has(from.table, name)) out.push({ path: at('columnsFrom', key), message: `"${from.table}" has no column "${name}"` });
        }
      }
    }
    if (board.title !== undefined && !index.has(table, board.title)) {
      out.push({ path: at('title'), message: `"${table}" has no column "${board.title}"` });
    }
    (board.totals ?? []).forEach((total, t) => {
      const summed = index.column(table, total.column);
      if (summed === undefined) out.push({ path: at('totals', t, 'column'), message: `"${table}" has no column "${total.column}"` });
      else if (!NUMERIC_TYPES.includes(summed.type)) out.push({ path: at('totals', t, 'column'), message: `"${table}.${total.column}" is not a number or money, so it cannot be totalled` });
      if ((board.totals ?? []).findIndex((other) => other.column === total.column && other.fn === total.fn) !== t) {
        out.push({ path: at('totals', t), message: `"${total.column}" is totalled this way twice` });
      }
    });
    for (const [name, written] of Object.entries(board.only ?? {})) {
      const tested = index.column(table, name);
      if (tested === undefined) {
        out.push({ path: at('only', name), message: `"${table}" has no column "${name}"` });
        continue;
      }
      if (name === board.column) {
        out.push({ path: at('only', name), message: `"${name}" is what the board's columns are: leave a column out of the board by its own table or enum, not by only` });
        continue;
      }
      if (!PAGE_BOARD_ONLY_TYPES.includes(tested.type)) {
        out.push({ path: at('only', name), message: `"${table}.${name}" is a ${tested.type}: only compares a choice, a yes/no, a link, text or a whole number` });
        continue;
      }
      const values = pageBoardOnlyValues(written);
      // A link holds the key of the row it points at: a whole number or text, whichever that table is keyed by.
      const fits = (value: string | number | boolean): boolean =>
        tested.type === 'fk' ? typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value)) : valueFits(tested, value);
      for (const value of values) {
        if (fits(value)) continue;
        out.push({
          path: at('only', name),
          message:
            tested.type === 'enum' && typeof value === 'string'
              ? `"${value}" is not one of the values of "${table}.${name}" (${(tested.enum ?? []).join(', ')})`
              : `${JSON.stringify(value)} is not a value "${table}.${name}" (${tested.type}) can hold`,
        });
      }
      if (new Set(values).size !== values.length) out.push({ path: at('only', name), message: `"${name}" lists a value twice` });
    }
  });
  return out;
}
