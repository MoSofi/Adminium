// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The columns of a board that names them (an app's `config.board`, stored on
 * the board item): what `PageBoardBinding` hands the template as
 * `boardColumns`.
 *
 * ── A BOARD OVER A TABLE (`columnsFrom`) ───────────────────────────────────
 * The columns are that table's rows, read through the ordinary data route in
 * the table's own order, each with read-time measures over the page's table:
 * a count of the cards in it and each of the board's totals. The server works
 * the measures out over the rows the READER reaches, so a rep held to their
 * own deals sees their own counts, and the count is of every card — not of
 * the cards listed, which stop at the list's limit. A board of some of its
 * table's rows (`only`: the open deals) asks each measure of those rows, with
 * the measure's `where`, so a header says what its cards say.
 *
 * ── A BOARD OVER AN ENUM (`columnsBinding`) ────────────────────────────────
 * The columns are the stored values; their counts and totals are one more
 * query of the page's batch (`planningData.ts`), a group per value.
 *
 * ── FRESHNESS ──────────────────────────────────────────────────────────────
 * The columns read lives under the `['widget-data', pageId, …]` key. Every
 * `table:*` frame invalidates the `['widget-data']` prefix
 * (`api/realtime.ts`), and so does the page after a save of its own
 * (`PageRenderer`): a stage added, renamed, reordered or removed, a card
 * saved by anybody, and a local drop all re-read the columns with no reload —
 * one request each, since the key is built from values and not from a
 * function.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { getFormatters } from '@adminium/i18n';
import { pageLayoutSchema, type PageEnvelope } from '@adminium/engine/config';
import {
  boardColumnsInstanceId,
  boardItemConfigOf,
  formatMoney,
  type BoardColumnRow,
  type BoardColumnsState,
  type BoardOnlyTest,
  type BoardTotal,
  type WidgetDataState,
} from '@adminium/widgets';

import { createCrudApi } from '../../api/crud.js';
import type { FormColumnFactReply } from '../../api/pages.js';
import { WIDGET_DATA_KEY_ROOT } from '../../api/widgetData.js';

const BOARD_WIDGETS: readonly string[] = ['kanban-board', 'kanban-swimlane-grid'];

/** The most rows of a table a board draws as columns: one request, and a board of more is not read as one. */
export const BOARD_COLUMNS_LIMIT = 100;

/** The measure each column's count is answered under, and the one for its n-th total. */
const COUNT_ALIAS = 'board_count';
const totalAlias = (index: number): string => `board_total_${String(index)}`;

/** What the page's board says of its columns, read off the stored layout. */
export interface BoardRead {
  /** The board's layout item. */
  instanceId: string;
  connectionId: string;
  /** The page's table: the cards. */
  cardsTable: string;
  /** The column of the cards a card is placed by. */
  column: string;
  from: { table: string; key: string; label: string; order: string | undefined } | undefined;
  /** An enum board's own count-and-total query is part of the page's batch. */
  counted: boolean;
  totals: BoardTotal[];
  /** Which cards are on the board; none ⇒ every row. */
  only: BoardOnlyTest[];
}

/** The board of a page that names its columns, or null: an ordinary board, or no board at all. */
export function boardReadOf(page: PageEnvelope): BoardRead | null {
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  const cardsTable = page.source.table;
  if (!layout.success || cardsTable === null || cardsTable === undefined || page.source.connectionId === null) return null;
  const item = layout.data.items.find((candidate) => BOARD_WIDGETS.includes(candidate.widget));
  if (item === undefined) return null;
  const cfg = boardItemConfigOf(item.config);
  const counted = item.config['columnsBinding'] !== undefined;
  if (cfg.columnsFrom === undefined && !counted) return null;
  return {
    instanceId: item.i,
    connectionId: page.source.connectionId,
    cardsTable,
    column: cfg.statusColumn,
    from: cfg.columnsFrom,
    counted,
    totals: cfg.totals,
    only: cfg.only,
  };
}

/** The `compute=` of the columns read: a count of each row's cards, and each total — of the cards on the board (`only`). */
export function boardCompute(read: Pick<BoardRead, 'cardsTable' | 'column' | 'totals'> & { only?: readonly BoardOnlyTest[] }): string {
  const where = read.only === undefined || read.only.length === 0 ? {} : { where: read.only.map((test) => ({ column: test.column, in: test.in })) };
  return JSON.stringify({
    measures: [
      { id: COUNT_ALIAS, table: read.cardsTable, fkColumn: read.column, fn: 'count', ...where },
      ...read.totals.map((total, index) => ({
        id: totalAlias(index),
        table: read.cardsTable,
        fkColumn: read.column,
        fn: total.fn,
        of: { terms: [{ sign: 'plus', factors: [total.column] }] },
        ...where,
      })),
    ],
  });
}

interface TotalFormat {
  label: string;
  money: boolean;
  currency: string | undefined;
}

/** How each total is written: money in the connection's currency when the column is money, a plain number otherwise. */
function totalFormats(totals: readonly BoardTotal[], columns: readonly FormColumnFactReply[] | undefined, currency: string | undefined): TotalFormat[] {
  return totals.map((total) => {
    const spec = columns?.find((column) => column.spec.name === total.column)?.spec as
      | { label?: unknown; semantic?: unknown; format?: unknown; currency?: unknown; display?: { kind?: unknown; currency?: unknown } }
      | undefined;
    const money = spec?.semantic === 'money' || spec?.format === 'currency' || spec?.display?.kind === 'currency';
    const own = typeof spec?.display?.currency === 'string' ? spec.display.currency : typeof spec?.currency === 'string' ? spec.currency : undefined;
    return { label: typeof spec?.label === 'string' ? spec.label : total.column, money, currency: currency ?? own };
  });
}

/** A column's totals as its header shows them; one alone is the bare figure, two are each named. */
function totalText(values: readonly unknown[], formats: readonly TotalFormat[], locale: string): string | undefined {
  const parts: string[] = [];
  values.forEach((value, index) => {
    const format = formats[index];
    const amount = value === null || value === undefined || value === '' ? null : Number(value);
    if (format === undefined || amount === null || !Number.isFinite(amount)) return;
    const figure = format.money
      ? formatMoney(amount, { locale, ...(format.currency === undefined ? {} : { currency: format.currency }) })
      : getFormatters(locale).number(amount, { maximumFractionDigits: 2 });
    parts.push(formats.length > 1 ? `${format.label} ${figure}` : figure);
  });
  return parts.length === 0 ? undefined : parts.join(' · ');
}

const numberOr = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** The table's rows as the board's columns. */
export function columnsFromRows(rows: readonly Record<string, unknown>[], read: BoardRead, formats: readonly TotalFormat[], locale: string): BoardColumnRow[] {
  const from = read.from;
  if (from === undefined) return [];
  const out: BoardColumnRow[] = [];
  for (const row of rows) {
    const key = row[from.key];
    if (typeof key !== 'string' && typeof key !== 'number') continue;
    const label = row[from.label];
    const count = numberOr(row[COUNT_ALIAS]);
    const total = totalText(read.totals.map((_, index) => row[totalAlias(index)]), formats, locale);
    out.push({
      id: String(key),
      value: key,
      label: label === null || label === undefined || label === '' ? String(key) : String(label),
      ...(count === undefined ? {} : { count }),
      ...(total === undefined ? {} : { total }),
    });
  }
  return out;
}

/** An enum board's groups (`{ items: [{ key, value, values }] }`) as its columns' counts and totals. */
export function columnsFromGroups(data: unknown, read: BoardRead, formats: readonly TotalFormat[], locale: string): BoardColumnRow[] {
  const items = (data as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return (items as { key?: unknown; value?: unknown; values?: Record<string, unknown> }[]).flatMap((item) => {
    if (typeof item.key !== 'string' && typeof item.key !== 'number') return [];
    const count = numberOr(item.values?.['cards'] ?? item.value);
    const total = totalText(read.totals.map((_, index) => item.values?.[`total${String(index)}`]), formats, locale);
    return [{ id: String(item.key), ...(count === undefined ? {} : { count }), ...(total === undefined ? {} : { total }) }];
  });
}

/**
 * The key the columns read is kept under. Under the widget-data prefix on
 * purpose (see the header): a frame of either table, and a save here, re-read
 * it. It names EVERYTHING the request is built from — the columns' table, the
 * key and the label it selects, its order and its measures — so a board that
 * is changed to take another key or another label from the same table reads
 * again, and is never drawn from the answer to the request it used to make.
 */
export function boardColumnsKey(pageId: string, read: Pick<BoardRead, 'connectionId' | 'from'> | null, compute: string | undefined) {
  const from = read?.from;
  return [WIDGET_DATA_KEY_ROOT, pageId, 'board-columns', read?.connectionId ?? null, from?.table ?? null, from?.key ?? null, from?.label ?? null, from?.order ?? null, compute ?? null] as const;
}

/**
 * The columns of the page's board as the server answers them, or undefined
 * for a board that does not name its columns (the template then works them
 * out of its cards, as it always has).
 */
export function useBoardColumns(
  page: PageEnvelope,
  opts: {
    /** The page's batch states: an enum board's groups are among them. */
    states: Record<string, WidgetDataState> | undefined;
    formColumns: readonly FormColumnFactReply[] | undefined;
    currency: string | undefined;
    locale: string;
    /** The cards are narrowed by a link: the columns are read without their counts and totals, which are of every card. */
    narrowed?: boolean | undefined;
  },
): BoardColumnsState | undefined {
  const queryClient = useQueryClient();
  const read = useMemo(() => boardReadOf(page), [page]);
  const from = read?.from;
  const narrowed = opts.narrowed === true;
  const compute = useMemo(() => (read === null || read.from === undefined || narrowed ? undefined : boardCompute(read)), [read, narrowed]);
  const formats = useMemo(() => totalFormats(read?.totals ?? [], opts.formColumns, opts.currency), [read, opts.formColumns, opts.currency]);

  const query = useQuery({
    queryKey: boardColumnsKey(page.id, read, compute),
    enabled: read !== null && from !== undefined,
    staleTime: 0,
    queryFn: () => {
      const target = from as NonNullable<typeof from>;
      return createCrudApi((read as BoardRead).connectionId, target.table).list({
        select: [...new Set([target.key, target.label])],
        order: [{ column: target.order ?? target.key, dir: 'asc' }],
        ...(compute === undefined ? {} : { compute }),
        limit: BOARD_COLUMNS_LIMIT,
      });
    },
  });
  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [WIDGET_DATA_KEY_ROOT, page.id] });
  }, [queryClient, page.id]);

  const groups = read !== null && read.counted ? opts.states?.[boardColumnsInstanceId(read.instanceId)] : undefined;
  return useMemo<BoardColumnsState | undefined>(() => {
    if (read === null) return undefined;
    if (read.from !== undefined) {
      if (query.isPending) return { status: 'loading' };
      if (query.isError) return { status: 'error', error: query.error, refetch };
      return { status: 'success', columns: columnsFromRows(query.data.data, read, formats, opts.locale), refetch };
    }
    // An enum board draws its columns without the counts; they join it when they arrive, and their failure costs only them.
    if (groups?.status !== 'success' || narrowed) return undefined;
    return { status: 'success', columns: columnsFromGroups(groups.data, read, formats, opts.locale) };
  }, [read, query.isPending, query.isError, query.error, query.data, refetch, groups, formats, opts.locale, narrowed]);
}
