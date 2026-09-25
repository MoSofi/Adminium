// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The document pipeline's WIRING — what turns `documents/render.ts` from a
 * function nobody calls into a feature.
 *
 * ─── THIS FILE EXISTS BECAUSE OF A PATTERN THIS REPOSITORY KEEPS HITTING ───
 *
 * Four features once passed every layer's tests and were reachable from
 * nothing. The tell was always the same: a grep for the export returned its
 * definition and its test, and no third line. `renderDocument` was in exactly
 * that state until this file — its own suite green, its action's suite green,
 * its job's schema written, and no server anywhere able to draw a document.
 *
 * So the assembly is one named function, called from `compose.ts`, rather than
 * an object literal inline at the call site. It has a name a grep finds, and
 * a place a reader can put a breakpoint.
 *
 * ─── THE SOURCE IS READ WITH THE REQUESTER'S GRANTS (D16) ──────────────────
 *
 * `readSource` re-reads the row and its children at render time rather than
 * trusting whatever the trigger captured. Two reasons, and the second is the
 * one that matters: a trigger's snapshot is a minute old by the time the undo
 * window closes, and — more importantly — a document is built from tables the
 * profile MAPS, which can be more than the one that was written. Reading them
 * here is what makes "every mapped table's read grant" a thing the routes can
 * resolve at all.
 */

import type { Kysely } from 'kysely';

import { addOnSettingsRepo, settingsRepo, type DocumentProfile, type MetaDb } from '@adminium/meta';

import type { AddOnRuntimeState } from '../add-ons/runtime.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { fetchByPk } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { connectionTenantConfig } from '@adminium/meta';
import type { EmailLogger } from '../email/send.js';
import type { FileStore } from '../files/store.js';
import { DocumentReadError, type RenderDeps, type SourceRead } from './render.js';
import { dayOn, readStatement, type StatementPeriod, type StatementSources } from './statement.js';
import type { ProfileMapping } from './subject.js';

/** Lines read per round trip, and the most one document may list. */
const LINES_PAGE = 200;
export const DOCUMENT_MAX_LINES = 5_000;

/**
 * The single-column foreign key `column` of `table` points along, from the
 * snapshot's relations (declared keys and accepted ones first), else the
 * column's own `references`. Null when the column is not one — a slot that
 * reads through it then has no value, and a required one fails the render
 * by name rather than being filled from a guess.
 */
export function outboundKey(view: SnapshotView, table: ResolvedTable, column: string): { tableId: string; column: string } | null {
  const best = view.model.relations
    .filter(
      (relation) =>
        relation.through === null &&
        relation.from.tableId === table.id &&
        relation.from.columns.length === 1 &&
        relation.from.columns[0] === column &&
        relation.to.columns.length === 1,
    )
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (best !== undefined) return { tableId: best.to.tableId, column: best.to.columns[0] as string };
  return table.table.columns.find((candidate) => candidate.name === column)?.references ?? null;
}

/**
 * The columns of linked rows a mapping reads, one query per foreign key: a
 * document naming the client's company, address and tax number reads the
 * client row once. Keyed `<fk>.<column>`, the way `buildSubject` asks.
 */
async function readLookups(
  db: Kysely<SourceDatabase>,
  view: SnapshotView,
  table: ResolvedTable,
  row: Readonly<Record<string, unknown>>,
  mapping: ProfileMapping,
): Promise<Record<string, unknown>> {
  const wanted = new Map<string, Set<string>>();
  for (const mapped of Object.values(mapping)) {
    if (!('ref' in mapped)) continue;
    const columns = wanted.get(mapped.ref) ?? new Set<string>();
    columns.add(mapped.column);
    wanted.set(mapped.ref, columns);
  }
  const out: Record<string, unknown> = {};
  for (const [fk, columns] of wanted) {
    const value = row[fk];
    if (value === null || value === undefined) continue;
    const target = outboundKey(view, table, fk);
    if (target === null) continue;
    let linked: ResolvedTable;
    try {
      linked = view.table(target.tableId);
    } catch {
      continue;
    }
    // Only columns the linked table has: a mapping naming one it lacks leaves
    // that slot empty, which a required slot reports by name.
    const readable = [...columns].filter((column) => linked.columns.has(column));
    if (readable.length === 0) continue;
    const found = (await db
      .selectFrom(linked.id as never)
      .select(readable as never)
      .where(target.column as never, '=', value as never)
      .limit(1)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (found === undefined) continue;
    for (const column of readable) out[`${fk}.${column}`] = found[column];
  }
  return out;
}

/**
 * One collection's rows, in the order the document lists them: the
 * collection's own `orderBy` (a line's position), else the profile's, then
 * the child's key — so two lines at the same position still come out the same
 * way every time. Read in pages; past {@link DOCUMENT_MAX_LINES} the render
 * fails rather than printing a document with lines silently missing.
 */
async function readLines(
  db: Kysely<SourceDatabase>,
  child: ResolvedTable,
  fkColumn: string,
  parentValue: unknown,
  orderBy: string | null,
): Promise<Record<string, unknown>[]> {
  if (!child.columns.has(fkColumn)) return [];
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += LINES_PAGE) {
    let query = db
      .selectFrom(child.id as never)
      .selectAll()
      .where(fkColumn as never, '=', parentValue as never);
    if (orderBy !== null && child.columns.has(orderBy)) query = query.orderBy(orderBy as never, 'asc');
    for (const pk of child.primaryKey) query = query.orderBy(pk as never, 'asc');
    const page = (await query.limit(LINES_PAGE).offset(offset).execute()) as Record<string, unknown>[];
    rows.push(...page);
    if (rows.length > DOCUMENT_MAX_LINES) {
      throw new DocumentReadError(`more than ${String(DOCUMENT_MAX_LINES)} lines in ${child.name}`);
    }
    if (page.length < LINES_PAGE) break;
  }
  return rows;
}

/** The row's own currency when it has a `currency` column holding a code; else null. */
function rowCurrency(table: ResolvedTable, row: Readonly<Record<string, unknown>>): string | null {
  if (!table.columns.has('currency')) return null;
  const value = row['currency'];
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/** What an app's profile carries beyond the mapping (see `app-profiles.ts`). */
interface ProfileOptions {
  /** The row's own formatted number is the document's; the register's counter is not used. */
  numberColumn?: string;
  statement?: StatementSources;
}

export interface DocumentPipelineDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  storage: FileStore;
  /** The live add-on runtime; null before the first build. */
  runtime: () => AddOnRuntimeState | null;
  /** Where delivery reports itself; the outcome is on the row regardless. */
  logger?: EmailLogger | undefined;
}


/**
 * The connection's currency and timezone, or the safe defaults.
 *
 * `connectionTenantConfig` reads exactly two columns and holds no DSN key —
 * which is why it exists, and why this uses it rather than the full repo.
 *
 * THE CURRENCY WAS HARDCODED `'USD'` here until 34d. Both the column and this
 * helper have existed since the public-API wave; the pipeline simply never
 * asked. Every document drawn on a connection configured in euros or pounds
 * was rendered in dollars, with the right NUMBERS — the minor units are
 * currency-agnostic — under the wrong symbol, which is the shape of a mistake
 * an operator notices from a customer's email rather than from a test.
 */
async function connectionFacts(
  meta: MetaDb,
  connectionId: string | null,
): Promise<{ currency: string; timezone: string }> {
  const config = connectionId === null ? null : await connectionTenantConfig(meta, connectionId);
  return { currency: config?.currency ?? 'USD', timezone: config?.timezone ?? 'UTC' };
}

export function createDocumentPipeline(deps: DocumentPipelineDeps): RenderDeps {
  return {
    meta: deps.meta,
    storage: deps.storage,
    runtime: deps.runtime,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),

    /**
     * What a render needs from the connection when it reads no row.
     *
     * The same two facts `readSource` takes off the connection for a mapped
     * render, resolved the same way — an intent must not draw a document dated
     * in a different timezone than one drawn from a row on the same connection.
     */
    connectionFacts: async (connectionId) => await connectionFacts(deps.meta, connectionId),

    settingsFor: (addOnKey) => addOnSettingsRepo(deps.meta).valuesFor(addOnKey),

    /**
     * The letterhead, in three layers.
     *
     *   1. THE ADD-ON'S OWN `business_name` / `business_lines` / `logo_data_url`
     *      — what somebody typed into the settings panel FOR DOCUMENTS. It
     *      wins because it is the only one of the three chosen for this
     *      purpose.
     *   2. The workspace's own name, so a deployment that never opened that
     *      panel still produces a document with a name on it rather than a
     *      blank header.
     *   3. The product name, which is a placeholder and looks like one — that
     *      is better than an empty letterhead, which looks like a bug.
     *
     * A DOCUMENT'S OWN AUTHORED VALUES BEAT ALL THREE and never reach here:
     * they are in the body, and the renderer prefers them (an invoice made in
     * March keeps March's letterhead however this panel is edited afterwards).
     */
    business: async (addOnKey?: string) => {
      const own = addOnKey === undefined ? {} : await addOnSettingsRepo(deps.meta).valuesFor(addOnKey);
      const typed = typeof own.business_name === 'string' ? own.business_name : '';
      const lines = Array.isArray(own.business_lines)
        ? own.business_lines.filter((line): line is string => typeof line === 'string')
        : [];
      const logo = typeof own.logo_data_url === 'string' ? own.logo_data_url : '';

      /*
       * The rest of the letterhead, each only when somebody typed it: an
       * empty field is not sent at all, so a provider never draws a "Tax
       * number:" label with nothing after it.
       */
      const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
      const extras = {
        ...(text(own.tax_number) === '' ? {} : { taxNumber: text(own.tax_number) }),
        ...(text(own.payment_instructions) === '' ? {} : { paymentInstructions: text(own.payment_instructions) }),
        ...(text(own.footer) === '' ? {} : { footer: text(own.footer) }),
      };

      if (typed !== '') {
        return { name: typed, lines, ...(logo === '' ? {} : { logoDataUrl: logo }), ...extras };
      }
      const workspace = await settingsRepo(deps.meta)
        .get('branding.appName')
        .catch(() => null);
      const name = typeof workspace === 'string' && workspace !== '' ? workspace : 'Adminium';
      return { name, lines, ...(logo === '' ? {} : { logoDataUrl: logo }), ...extras };
    },

    /*
     * `tables` is the mapped-table list the ROUTE resolved grants over; the
     * read itself follows the mapping, so it is named and not used here.
     */
    readSource: async ({ profile, pk, period, at }): Promise<SourceRead | null> => {
      const view = await loadSnapshotView(deps.meta, profile.connectionId);
      const { db } = await deps.manager.data(profile.connectionId);
      return await readProfileSource({
        db: db as Kysely<SourceDatabase>,
        view,
        profile,
        pk,
        period,
        at,
        facts: await connectionFacts(deps.meta, profile.connectionId),
      });
    },
  };
}

/**
 * The row a document is drawn from, and everything around it the mapping
 * names: its lines in order, the columns of rows it links to, its own
 * currency and number, and — for a statement — the period's entries.
 */
export async function readProfileSource(input: {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  profile: DocumentProfile;
  pk: Readonly<Record<string, unknown>>;
  period?: StatementPeriod | undefined;
  at: number;
  facts: { currency: string; timezone: string };
}): Promise<SourceRead | null> {
  const { db, view, profile, facts } = input;
  const table = view.table(profile.table);

  const row = (await fetchByPk(db, table, input.pk as never)) as Record<string, unknown> | undefined;
  // The row was deleted between the trigger and the job — the undo
  // window's ordinary outcome, and a SKIP rather than a failure.
  if (row === undefined) return null;

  /*
   * Child rows, one query per mapped collection.
   *
   * ONE QUERY PER COLLECTION and not a join: a document has at most a
   * handful of collections, each is keyed by one foreign column, and a
   * join would multiply the header row by the line count and leave this
   * file to un-multiply it. The N here is the number of MAPPED
   * collections, not the number of rows.
   */
  const mapping = profile.mapping as ProfileMapping;
  const collections: Record<string, readonly Record<string, unknown>[]> = {};
  const parentKey = table.primaryKey[0];
  for (const [slotId, mapped] of Object.entries(mapping)) {
    if (!('collection' in mapped) || parentKey === undefined) continue;
    let child: ResolvedTable;
    try {
      child = view.table(mapped.collection.table);
    } catch {
      continue;
    }
    collections[slotId] = await readLines(
      db,
      child,
      mapped.collection.fkColumn,
      row[parentKey],
      mapped.collection.orderBy ?? profile.orderBy ?? null,
    );
  }

  const options = profile.options as ProfileOptions;
  const own = options.numberColumn;
  const statement =
    options.statement === undefined || parentKey === undefined
      ? undefined
      : await readStatement({
          db,
          view,
          sources: options.statement,
          clientKey: row[parentKey],
          period: input.period ?? 'all',
          today: dayOn(input.at, facts.timezone),
        });

  /*
   * The connection's OWN timezone (0018), not the server's: a document dated
   * off the process clock's zone is dated off somebody else's Tuesday. The
   * currency is the ROW's own when it carries one — an invoice in yen on a
   * connection that bills in euros is still in yen — else the connection's.
   */
  return {
    row,
    collections,
    lookups: await readLookups(db, view, table, row, mapping),
    entity: {
      connectionId: profile.connectionId,
      table: profile.table,
      pk: Object.fromEntries(table.primaryKey.map((column) => [column, row[column]])),
      label: String(row[table.primaryKey[0] ?? 'id'] ?? ''),
    },
    currency: rowCurrency(table, row) ?? facts.currency,
    timezone: facts.timezone,
    ...(own === undefined || !table.columns.has(own)
      ? {}
      : { ownNumber: row[own] === null || row[own] === undefined || row[own] === '' ? null : String(row[own]) }),
    ...(statement === undefined ? {} : { statement }),
  };
}

/** Every table a set of profiles reads — what the routes resolve grants over. */
export { mappedTables } from './subject.js';
