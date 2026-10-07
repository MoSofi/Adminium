// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /words/:addOn/:wordsId?table=<stored name>&ids=<id,id,…>[&date=]` —
 * WHAT STAFF ARE TOLD of the rows a screen shows, in an add-on's stock words.
 *
 *  - The table is named as it is stored (`pos:menu_items`, `inventory:items`):
 *    an app's screen knows its own names, never the table's real one, and a
 *    rename keeps the name. A name that stands for nothing here is 404.
 *  - The caller reads the table asked about, or the answer is 403.
 *  - The add-on is asked once, and the answer is never kept: a staff screen
 *    is told the figure as it is. When it cannot answer the screen is told so
 *    (409), never "in stock".
 *  - A caller who also reads the add-on's stock tables is given the figure
 *    behind the word — the exact count, the batch, its expiry, the line that
 *    runs out first. Any other caller is given what a customer is.
 *  - Where the rows are also limited a day (a dish's portions), the smaller
 *    of the two is the answer, and which one it was is said.
 */
import { ledgersOf, wordsOf, type Manifest } from '@adminium/manifest';
import { connectionTenantConfig, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { ConnectionManager } from '../../connections/manager.js';
import { parentAnswer } from '../../crud/capacity/availability.js';
import { rulesFor, type ParentRule } from '../../crud/capacity/rules.js';
import { tableRulesFor } from '../../crud/column-rules.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { ledgerSettings } from '../../crud/ledger-reads.js';
import { planWords, publicLeft, WORDS_IDS_MAX, WordsUnavailable, type WordsLine } from '../../crud/ledger-write.js';
import { venueClock } from '../../crud/venue-time.js';
import type { WriteTarget } from '../../crud/write-context.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { ForbiddenError, NotFoundError, PostingRefusedError, ValidationFailedError } from '../../errors.js';
import type { LedgerRuntime } from '../../ledgers/registry.js';
import { askedIds, couldBeKey, wordsFitTable } from '../public/words-availability.js';
import { staffWordsParams, staffWordsQuery, staffWordsReply, type StaffWordsLine } from './schema.js';

export interface WordsRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
  ledgers: LedgerRuntime;
}

/** How much of a name a screen is handed. */
const NAME_MAX = 80;

/** The limit of a day on rows of `table` (a dish's portions): a parent limit, counted by day, of a table that sells them. */
export function portionsRuleOf(view: SnapshotView, table: ResolvedTable): { rule: ParentRule; of: ResolvedTable } | null {
  for (const one of view.model.tables) {
    if (one.capacityRules === undefined) continue;
    let of: ResolvedTable;
    try {
      of = view.table(one.id);
    } catch {
      continue;
    }
    for (const rule of rulesFor(view, of)) {
      if (rule.kind === 'parent' && rule.day !== null && rule.via !== null && rule.via.table.id === table.id) return { rule, of };
    }
  }
  return null;
}

/**
 * The stock answer and the day's portions, joined: the smaller is what is
 * left, and the answer says which it was. Out when either is none. When the
 * portions bind, no stock line is what runs out, and none is named.
 */
export function joinPortions(line: WordsLine, portions: number | undefined): WordsLine {
  if (portions === undefined) return line.state === 'in' || line.cause !== undefined ? line : { ...line, cause: 'stock' };
  const figure = line.exact ?? line.left;
  const stock = figure === undefined ? undefined : Number(figure);
  const binds = stock === undefined || !Number.isFinite(stock) || portions < stock;
  if (!binds) return { ...line, cause: 'stock', ...(stock === 0 ? { state: 'out' as const } : {}) };
  const { first: _first, ...rest } = line;
  return { ...rest, exact: String(portions), cause: 'portions', ...(portions <= 0 ? { state: 'out' as const } : {}) };
}

/** A line as a caller who reads the stock tables is given it. */
function fullLine(line: WordsLine, left: number | undefined): StaffWordsLine {
  return {
    id: line.id,
    state: line.state,
    ...(left === undefined ? {} : { left }),
    ...(line.exact === undefined ? (line.left === undefined ? {} : { exact: line.left }) : { exact: line.exact }),
    ...(line.after === undefined ? {} : { after: line.after }),
    ...(line.batch === undefined ? {} : { batch: line.batch }),
    ...(line.expires === undefined ? {} : { expires: line.expires }),
    ...(line.cause === undefined ? {} : { cause: line.cause }),
    ...(line.first === undefined ? {} : { first: { item: line.first.item.slice(0, NAME_MAX), unit: line.first.unit.slice(0, NAME_MAX) } }),
    ...(line.soon === true ? { soon: true as const } : {}),
  };
}

export function wordsRoutes(deps: WordsRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta, ledgers } = deps;

  return async (app) => {
    app.get(
      '/words/:addOn/:wordsId',
      {
        preHandler: [app.requireAuth],
        schema: { params: staffWordsParams, querystring: staffWordsQuery, response: { 200: staffWordsReply } },
      },
      async (request) => {
        const { addOn, wordsId } = request.params;
        const nothing = (): NotFoundError => new NotFoundError('There are no such stock words here.', { addOn, words: wordsId });
        const row = await meta.db.selectFrom('adminium_manifests').select(['connectionId']).where('manifestKey', '=', addOn).where('kind', '=', 'add-on').executeTakeFirst();
        if (row === undefined || row.connectionId === null) throw nothing();
        const connectionId = row.connectionId;
        await ledgers.refresh?.();
        const manifest = ledgers.manifestOf(connectionId, addOn);
        const words = manifest === null ? undefined : wordsOf(manifest as unknown as Manifest).find((one) => one.id === wordsId);
        if (manifest === null || words === undefined) throw nothing();

        // The table as it is stored: an app's own name for it, whatever it is called now.
        const view = await loadSnapshotView(meta, connectionId);
        const tableId = ledgers.tableOfRef?.(connectionId, request.query.table) ?? null;
        let table: ResolvedTable | null = null;
        try {
          table = tableId === null ? null : view.table(tableId);
        } catch {
          table = null;
        }
        if (table === null) throw new NotFoundError('There is no such table here.', { table: request.query.table });
        if (!(await request.can(`table:${connectionId}:${table.id}:read`))) throw new ForbiddenError('You may not read this table.');

        const action = ledgersOf(manifest).find((one) => one.id === words.ledger)?.actions[words.action];
        const ledger = ledgers.ledgerOf?.(view, addOn, words.ledger) ?? null;
        // Words over an item are asked of the items' own table, and of no other.
        if (action !== undefined && ledger !== null && !wordsFitTable(ledger, action, words.input, table.id)) throw new NotFoundError('There is no such table here.', { table: request.query.table });

        const asked = askedIds(request.query.ids);
        if (asked.length === 0 || asked.length > WORDS_IDS_MAX) throw new ValidationFailedError(`Ask about one to ${String(WORDS_IDS_MAX)} rows.`, { reason: asked.length === 0 ? 'none' : 'too-many' });
        // An id that could not be a row's key is no row: left out, never handed to the add-on.
        const [key, ...more] = table.primaryKey;
        const type = key === undefined || more.length > 0 ? null : (table.columns.get(key)?.logicalType ?? 'text');
        const ids = type === null ? [] : asked.filter((id) => couldBeKey(id, type));
        if (ids.length === 0) return { data: [] };

        const { db, dialect } = await manager.data(connectionId);
        const timezone = (await connectionTenantConfig(meta, connectionId))?.timezone ?? 'UTC';
        const now = new Date();
        let lines: WordsLine[];
        try {
          lines = await planWords(ledgers, { view, db, timezone, addOn, words: wordsId, tableRef: request.query.table, keys: ids, origin: 'staff', now, rollupsOf: (of) => tableRulesFor({ view, table: of })?.rollupsInto ?? [] });
        } catch (error) {
          if (!(error instanceof WordsUnavailable)) throw error;
          throw new PostingRefusedError('The add-on could not say what is left.', { reason: 'planner-failed', ledger: words.ledger });
        }

        // The day's portions, where the rows are also limited a day.
        const today = venueClock(now, timezone).day;
        const day = request.query.date ?? today;
        const portions = portionsRuleOf(view, table);
        const leftToday = new Map<string, number>();
        if (portions !== null) {
          const target: WriteTarget = { connectionId, view, table: portions.of, db, dialect, timezone };
          for (const state of await parentAnswer(db, target, portions.rule, ids, { day, qty: 1, now, showLeft: { below: Number.MAX_SAFE_INTEGER } })) {
            if (state.left !== undefined) leftToday.set(state.id, state.left);
            else if (state.state === 'soldout') leftToday.set(state.id, 0);
          }
        }
        const joined = lines.map((line) => joinPortions(line, leftToday.get(line.id)));

        // The figure behind the word is for a caller who reads the rows it is a column of.
        let full = action !== undefined && ledger !== null;
        for (const lock of action?.locks ?? []) {
          const stock = ledger?.table(lock.table) ?? null;
          if (stock === null || !(await request.can(`table:${connectionId}:${stock.id}:read`))) full = false;
        }
        const settings = ledger === null || words.showLeftBelow === undefined ? {} : await ledgerSettings(ledger, db);
        return {
          data: joined.map((line) => {
            // What a customer may be told: under the owner's setting, and of today only.
            const shown = day === today ? publicLeft(settings, words, line.left, line.state) : undefined;
            const left = shown === undefined ? undefined : Number(shown);
            return full ? fullLine(line, left) : { id: line.id, state: line.state, ...(left === undefined ? {} : { left }) };
          }),
        };
      },
    );
  };
}
