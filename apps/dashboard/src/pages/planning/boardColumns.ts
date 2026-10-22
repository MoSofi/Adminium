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
 * A heading's badge (`columnsFrom.badge`: a stage's odds) is one more column
 * of that same read, so it is the reader's too: somebody whose role does not
 * show the column is refused it by name, and the board then reads its columns
 * again without the badge rather than not at all.
 *
 * ── A BOARD OVER AN ENUM (`columnsBinding`) ────────────────────────────────
 * The columns are the stored values; their counts and totals are one more
 * query of the page's batch (`planningData.ts`), a group per value.
 *
 * ── FRESHNESS ──────────────────────────────────────────────────────────────
 * The columns read lives under the `['widget-data', pageId, …]` key, beside
 * the cards' batch. It is read again after a save made on this page
 * (`PageRenderer` invalidates the `['widget-data']` prefix), and when a frame
 * says the cards' table or the columns' table changed (`boardLive.ts`
 * subscribes the page to both tables' `widget-data:` channels): a stage
 * added, renamed, reordered or removed, a card saved by a colleague, and a
 * local drop all re-read the columns with no reload — one request for a
 * burst of frames, since the key is built from values and not from a
 * function.
 *
 * ── ONE PERSON'S CARDS (`toolbar.person`) ──────────────────────────────────
 * A board whose toolbar filters by a person is narrowed to that person's
 * cards by one more test, `{ column: person, … }`, added to everything the
 * board reads of them: the cards' query, an enum board's counts, a table
 * board's measures and the toolbar's total (`withPerson`, `boardCompute`).
 * The people the filter offers are read without it, so everybody stays
 * offered. Each read is the server's, with the reader's own row limits.
 *
 * ── MORE ROWS THAN COLUMNS ─────────────────────────────────────────────────
 * A board draws the first `BOARD_COLUMNS_LIMIT` rows of the table. One row
 * more is asked for, so that a table with more is known to have more and the
 * board says so (`more`); a card of a stage past the last column is on no
 * column, and counted among the cards that are not shown.
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
  from: { table: string; key: string; label: string; order: string | undefined; badge?: { column: string; as?: 'text' | 'number' | 'percent' | undefined } | undefined } | undefined;
  /** An enum board's own count-and-total query is part of the page's batch. */
  counted: boolean;
  totals: BoardTotal[];
  /** Which cards are on the board; none ⇒ every row. */
  only: BoardOnlyTest[];
  /** The staff column the toolbar filters the cards by (`toolbar.person`), if it does. */
  personColumn: string | undefined;
}

/** The board of a page that names its columns, or null: an ordinary board, or no board at all. */
export function boardReadOf(page: PageEnvelope): BoardRead | null {
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  const cardsTable = page.source.table;
  if (!layout.success || cardsTable === null || cardsTable === undefined || page.source.connectionId === null) return null;
  const item = layout.data.items.find((candidate) => BOARD_WIDGETS.includes(candidate.widget));
  if (item === undefined) return null;
  const cfg = boardItemConfigOf(item.config);
  // A board whose stored `only` cannot be trusted is not drawn (`PageBoard` says why): nothing is asked for it.
  if (cfg.onlyInvalid) return null;
  const counted = item.config['columnsBinding'] !== undefined;
  if (cfg.columnsFrom === undefined && !counted && cfg.toolbar === undefined) return null;
  return {
    instanceId: item.i,
    connectionId: page.source.connectionId,
    cardsTable,
    column: cfg.statusColumn,
    from: cfg.columnsFrom,
    counted,
    totals: cfg.totals,
    only: cfg.only,
    personColumn: cfg.toolbar?.person,
  };
}

/** The test that narrows a board to one person's cards, as the data routes and the batch both read it. */
const personTest = (column: string, person: string) => ({ column, op: 'eq' as const, value: person });

/**
 * The page as the board reads it narrowed to one person (`toolbar.person`):
 * that person's test added to the cards' query, an enum board's counts and
 * each figure of the toolbar's total — never to the people the filter
 * offers. The same page when nobody is chosen, or the board filters by no one.
 */
export function withPerson(page: PageEnvelope, person: string | null): PageEnvelope {
  if (person === null) return page;
  const read = boardReadOf(page);
  if (read?.personColumn === undefined) return page;
  const column = read.personColumn;
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  if (!layout.success) return page;
  const narrowed = (raw: unknown): unknown => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
    const descriptor = raw as { filters?: unknown };
    return { ...descriptor, filters: [...(Array.isArray(descriptor.filters) ? descriptor.filters : []), personTest(column, person)] };
  };
  const items = layout.data.items.map((item) => {
    if (item.i !== read.instanceId) return item;
    const config: Record<string, unknown> = { ...item.config, binding: narrowed(item.config['binding']) };
    if (item.config['columnsBinding'] !== undefined) config['columnsBinding'] = narrowed(item.config['columnsBinding']);
    if (Array.isArray(item.config['toolbarBindings'])) config['toolbarBindings'] = (item.config['toolbarBindings'] as unknown[]).map(narrowed);
    return { ...item, config };
  });
  return { ...page, config: { ...page.config, layout: { ...layout.data, items } } };
}

/**
 * The `compute=` of the columns read: a count of each row's cards, and each total — of the cards on the board (`only`),
 * and of one person's alone when the toolbar is narrowed to them.
 */
export function boardCompute(read: Pick<BoardRead, 'cardsTable' | 'column' | 'totals'> & { only?: readonly BoardOnlyTest[]; person?: { column: string; id: string } | undefined }): string {
  const tests = [...(read.only ?? []).map((test) => ({ column: test.column, in: test.in })), ...(read.person === undefined ? [] : [{ column: read.person.column, in: [read.person.id] }])];
  const where = tests.length === 0 ? {} : { where: tests };
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

/** How each total is written: money when the column is money — in the column's own currency, else the connection's — a plain number otherwise. */
function totalFormats(totals: readonly BoardTotal[], columns: readonly FormColumnFactReply[] | undefined, currency: string | undefined): TotalFormat[] {
  return totals.map((total) => {
    const spec = columns?.find((column) => column.spec.name === total.column)?.spec as
      | { label?: unknown; semantic?: unknown; format?: unknown; currency?: unknown; display?: { kind?: unknown; currency?: unknown } }
      | undefined;
    const money = spec?.semantic === 'money' || spec?.format === 'currency' || spec?.display?.kind === 'currency';
    const own = typeof spec?.display?.currency === 'string' ? spec.display.currency : typeof spec?.currency === 'string' ? spec.currency : undefined;
    // The column's own currency first: a table priced in dollars on a connection kept in euros totals in dollars.
    return { label: typeof spec?.label === 'string' ? spec.label : total.column, money, currency: own ?? currency };
  });
}

/** How a board's totals are written on its toolbar, from the server's figures: as each column's header writes them. */
export function useBoardTotalsWriter(
  page: PageEnvelope,
  columns: readonly FormColumnFactReply[] | undefined,
  currency: string | undefined,
  locale: string,
): (values: readonly (number | null)[]) => string | undefined {
  const read = useMemo(() => boardReadOf(page), [page]);
  const formats = useMemo(() => totalFormats(read?.totals ?? [], columns, currency), [read, columns, currency]);
  return useCallback((values) => totalText(values, formats, locale), [formats, locale]);
}

/** How one column's amounts are written on a card: as a header's total of that column is. */
export function amountWriter(column: string, columns: readonly FormColumnFactReply[] | undefined, currency: string | undefined, locale: string): (amount: number) => string {
  const format = totalFormats([{ column, fn: 'sum' }], columns, currency)[0] as TotalFormat;
  return (amount) => (format.money ? formatMoney(amount, { locale, ...(format.currency === undefined ? {} : { currency: format.currency }) }) : getFormatters(locale).number(amount, { maximumFractionDigits: 2 }));
}

/** A column's totals as its header shows them; one alone is the bare figure, two are each named. */
export function totalText(values: readonly unknown[], formats: readonly TotalFormat[], locale: string): string | undefined {
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

/** A column's badge as its heading shows it: a share kept as a fraction as "10%", a number, or the text as kept (cut short). */
export function badgeText(value: unknown, as: 'text' | 'number' | 'percent' | undefined, locale: string): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (as === 'percent' || as === 'number') {
    const n = numberOr(value);
    if (n === undefined) return undefined;
    return as === 'percent' ? getFormatters(locale).percent(n, { fractionDigits: Number.isInteger(Math.round(n * 10000) / 100) ? 0 : 1 }) : getFormatters(locale).number(n, { maximumFractionDigits: 2 });
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 24) : undefined;
}

/** The table's rows as the board's columns. */
export function columnsFromRows(rows: readonly Record<string, unknown>[], read: BoardRead, formats: readonly TotalFormat[], locale: string): BoardColumnRow[] {
  const from = read.from;
  if (from === undefined) return [];
  const out: BoardColumnRow[] = [];
  // One row more than a board draws was asked for, to know there are more: it is not drawn.
  for (const row of rows.slice(0, BOARD_COLUMNS_LIMIT)) {
    const key = row[from.key];
    if (typeof key !== 'string' && typeof key !== 'number') continue;
    const label = row[from.label];
    const count = numberOr(row[COUNT_ALIAS]);
    const total = totalText(read.totals.map((_, index) => row[totalAlias(index)]), formats, locale);
    const badge = from.badge === undefined ? undefined : badgeText(row[from.badge.column], from.badge.as, locale);
    out.push({
      id: String(key),
      value: key,
      label: label === null || label === undefined || label === '' ? String(key) : String(label),
      ...(count === undefined ? {} : { count }),
      ...(total === undefined ? {} : { total }),
      ...(badge === undefined ? {} : { badge }),
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
 * The key the columns read is kept under. Under the widget-data prefix, and
 * the page's id, on purpose (see the header): a frame of either table, and a
 * save here, re-read it. It names EVERYTHING the request is built from — the columns' table, the
 * key and the label it selects, its order and its measures — so a board that
 * is changed to take another key or another label from the same table reads
 * again, and is never drawn from the answer to the request it used to make.
 */
export function boardColumnsKey(pageId: string, read: Pick<BoardRead, 'connectionId' | 'from'> | null, compute: string | undefined) {
  const from = read?.from;
  return [WIDGET_DATA_KEY_ROOT, pageId, 'board-columns', read?.connectionId ?? null, from?.table ?? null, from?.key ?? null, from?.label ?? null, from?.order ?? null, compute ?? null, from?.badge?.column ?? null] as const;
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
    /** The person the toolbar narrows the board to: each column's count and totals are of their cards. */
    person?: string | null | undefined;
  },
): BoardColumnsState | undefined {
  const queryClient = useQueryClient();
  const read = useMemo(() => boardReadOf(page), [page]);
  const from = read?.from;
  const narrowed = opts.narrowed === true;
  const person = opts.person ?? null;
  const compute = useMemo(
    () =>
      read === null || read.from === undefined || narrowed
        ? undefined
        : boardCompute({ ...read, ...(person === null || read.personColumn === undefined ? {} : { person: { column: read.personColumn, id: person } }) }),
    [read, narrowed, person],
  );
  const formats = useMemo(() => totalFormats(read?.totals ?? [], opts.formColumns, opts.currency), [read, opts.formColumns, opts.currency]);

  const query = useQuery({
    queryKey: boardColumnsKey(page.id, read, compute),
    enabled: read !== null && from !== undefined,
    staleTime: 0,
    queryFn: async () => {
      const target = from as NonNullable<typeof from>;
      const ask = (badge: string | undefined) =>
        createCrudApi((read as BoardRead).connectionId, target.table).list({
          select: [...new Set([target.key, target.label, ...(badge === undefined ? [] : [badge])])],
          order: [{ column: target.order ?? target.key, dir: 'asc' }],
          ...(compute === undefined ? {} : { compute }),
          // One more than is drawn: a table with more rows than that is then known to have more.
          limit: BOARD_COLUMNS_LIMIT + 1,
        });
      if (target.badge === undefined) return ask(undefined);
      try {
        return await ask(target.badge.column);
      } catch (error) {
        // The badge's column is one this reader's role does not show: the board is theirs without it.
        if ((error as { code?: unknown } | null)?.code !== 'COLUMN_FORBIDDEN') throw error;
        return ask(undefined);
      }
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
      return {
        status: 'success',
        columns: columnsFromRows(query.data.data, read, formats, opts.locale),
        ...(query.data.data.length > BOARD_COLUMNS_LIMIT ? { more: true } : {}),
        refetch,
      };
    }
    // An enum board draws its columns without the counts; they join it when they arrive, and their failure costs only them.
    if (groups?.status !== 'success' || narrowed) return undefined;
    return { status: 'success', columns: columnsFromGroups(groups.data, read, formats, opts.locale) };
  }, [read, query.isPending, query.isError, query.error, query.data, refetch, groups, formats, opts.locale, narrowed]);
}
