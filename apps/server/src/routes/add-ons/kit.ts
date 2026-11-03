// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /add-ons/:key/kit` — what an add-on's own page may read and write.
 *
 * A page built on the data kit names its add-on's tables by the short names
 * of its manifest and nothing else: no connection, no real table name. This
 * one read tells the kit's hooks where those tables are, what the signed-in
 * reader may do to each, which columns their role does not read, which moves
 * of a row's state they may make and which of its actions they are offered,
 * and which tables of the owner's database hand rows to the add-on.
 *
 * A forms add-on is also told which tables its forms may become a row of
 * (`via: 'forms'`): every table an app on the add-on's database opens to
 * forms through a `publicAccess` entry under the reserved key `forms`, with
 * its label, its app's name and the columns that entry lets an answer fill
 * (name, label, kind, whether the row must have it, whether it is a link
 * to another row — a link is filled only from a named survey's invitation,
 * never from a question —, an enum's values and a text's longest), the column
 * the entry names for a form's fixed "Source", and the generated page of the
 * table the reader may open (where an answer's "Became" links its row). Read
 * only: the page lists them in its builder, and reads no row of them.
 *
 * It grants nothing. Every answer here is asked again by the data routes on
 * the read or the write itself; the page only stops offering what would be
 * refused.
 */
import { addOnManifestSchema, formsEntriesOf, formsOf, validateManifest, type AddOnManifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, pagesRepo, userPrefsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { hostTablesOf } from '../../add-ons/host-tables.js';
import { addOnPagePermission } from '../../add-ons/page-gate.js';
import { storedTableRef, type TableRefIndex } from '../../apps/table-ref.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { readViewFor } from '../../crud/read-view.js';
import { NotFoundError } from '../../errors.js';
import { pagePartOff } from '../../rbac/app-parts.js';
import { factsViewFor } from '../pages/column-facts.js';
import { movesFor, rolesOf, stateActionFacts } from '../pages/state-actions.js';

export interface AddOnKitDeps {
  meta: MetaDb;
}

const SCHEMA_REMAP = 'system:schema:remap';
/** Who may make and send a campaign (`routes/email-templates`). */
const SETTINGS_MANAGE = 'system:settings:manage';

const kitTable = z.object({
  /** The table's id, as the data routes take it. */
  id: z.string(),
  can: z.object({ read: z.boolean(), create: z.boolean(), update: z.boolean(), delete: z.boolean() }),
  /** The columns the reader's role does not read: never shown, never asked for. */
  unreadable: z.array(z.string()),
  states: z
    .object({
      column: z.string(),
      /** The moves this reader may make, by the state they leave; never one only a posting makes. */
      moves: z.record(z.string(), z.array(z.string())),
      /** The table's actions this reader is offered: never a target, never what one writes. */
      actions: z.array(z.object({ id: z.string(), kind: z.enum(['move', 'set', 'link', 'child']), from: z.array(z.string()), notBy: z.array(z.string()).optional(), by: z.string().optional() })).optional(),
    })
    .optional(),
});

/** A column a form's answer may fill, as the builder offers it. */
const formsColumn = z.object({
  name: z.string(),
  label: z.string(),
  /** The column's kind (`text`, `integer`, `enum`, `date`, …). */
  kind: z.string(),
  /** The row must have it: nothing else fills it (no default, no fixed value). */
  required: z.boolean(),
  /** A link to another row: filled only from a named survey's invitation, never from a question. */
  link: z.boolean(),
  /** An enum's values, in order: what a choice question's ids must be to fill it. */
  values: z.array(z.string()).optional(),
  /** The longest text the column holds. */
  maxLength: z.number().optional(),
});

export const addOnKitReply = z.object({
  connectionId: z.string(),
  /** The add-on's own tables, by the short names of its manifest; one not made yet is left out. */
  tables: z.record(z.string(), kitTable),
  /** The tables of the owner's database that hand rows to the add-on. Read only. */
  hosts: z.array(
    z.object({
      tableRef: z.string(),
      id: z.string(),
      label: z.string(),
      /** Posts into a ledger, carries a price rule, links its rows to the add-on's own (`link`), or is opened to its forms. */
      via: z.enum(['posting', 'adjust', 'link', 'forms']),
      /** A table opened to forms: the name of the app that opens it. */
      app: z.string().optional(),
      /** A table opened to forms: the columns an answer may fill. */
      columns: z.array(formsColumn).optional(),
      /** A table opened to forms: the slug of a generated page of it this reader may open (a row is at `/p/<page>/r/<key>`). */
      page: z.string().optional(),
      /** A table opened to forms: the column a form's fixed "Source" value goes into, as the app's entry names it. */
      sourceColumn: z.string().optional(),
    }),
  ),
  /** What the reader holds of the permissions a page asks about by name. */
  has: z.record(z.string(), z.boolean()),
  /** The currency of the database its tables are in (ISO 4217), or null when the owner set none: what a page writes money in. */
  currency: z.string().nullable(),
});

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('the kit never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('the kit never reads a credential');
  },
};

/** The tables the apps on this database open to forms, with the columns an answer may fill (see the header). */
async function formsHosts(
  meta: MetaDb,
  connectionId: string,
  view: SnapshotView,
  index: TableRefIndex,
  own: ReadonlySet<string>,
  can: (permission: string) => Promise<boolean>,
): Promise<z.infer<typeof addOnKitReply>['hosts']> {
  const out: z.infer<typeof addOnKitReply>['hosts'] = [];
  const pages = (await pagesRepo(meta).listForConnection(connectionId)).filter((page) => page.isEnabled).sort((a, b) => a.slug.localeCompare(b.slug));
  /** A generated page of the table this reader may open, its app's part on: where "Became" links a row to. */
  async function pageOf(tableId: string): Promise<string | null> {
    for (const page of pages) {
      const source = (page.config as { source?: { table?: unknown } } | null)?.source;
      if (source?.table !== tableId) continue;
      if (await pagePartOff(meta, page.config)) continue;
      if (await can(`page:${page.id}:view`)) return page.slug;
    }
    return null;
  }
  const apps = (await manifestsRepo(meta, NO_SECRETS).list('app')).filter((entry) => entry.row.connectionId === connectionId && entry.row.status === 'installed');
  for (const entry of apps.sort((a, b) => a.row.manifestKey.localeCompare(b.row.manifestKey))) {
    const read = validateManifest(entry.document);
    if (!read.ok) continue;
    const name = typeof read.manifest.name === 'string' ? read.manifest.name : entry.row.manifestKey;
    for (const opened of formsEntriesOf(read.manifest)) {
      const record = index.records.find((candidate) => candidate.appKey === entry.row.manifestKey && candidate.ref === opened.table && ['created', 'adopted', 'shared'].includes(candidate.state));
      if (record === undefined) continue;
      const model = view.model.tables.find((table) => table.name === record.tableName && (record.schemaName === null || table.schema === record.schemaName));
      if (model === undefined || own.has(model.id)) continue;
      let table;
      try {
        table = view.table(model.id);
      } catch {
        continue;
      }
      const links = new Set(view.model.relations.filter((relation) => relation.through === null && relation.from.tableId === table.id && relation.from.columns.length === 1).map((relation) => relation.from.columns[0]!));
      const columns = opened.writable.flatMap((column) => {
        const resolved = table.columns.get(column);
        const facts = table.table.columns.find((candidate) => candidate.name === column);
        if (resolved === undefined || facts === undefined) return [];
        const required = opened.requires.includes(column) || (!resolved.nullable && (facts.default ?? null) === null && opened.defaults[column] === undefined && !opened.decided.includes(column));
        const values = facts.enumRef === null ? undefined : view.model.enums.find((one) => one.id === facts.enumRef)?.values;
        return [
          {
            name: column,
            label: facts.label ?? column,
            kind: resolved.logicalType as string,
            required,
            link: links.has(column),
            ...(values === undefined ? {} : { values: [...values] }),
            ...(facts.maxLength === null || facts.maxLength === undefined ? {} : { maxLength: facts.maxLength }),
          },
        ];
      });
      const page = await pageOf(table.id);
      out.push({
        tableRef: storedTableRef(index, table.id),
        id: table.id,
        label: table.table?.label ?? table.name,
        via: 'forms',
        app: name,
        columns,
        ...(page === null ? {} : { page }),
        ...(opened.source === undefined || !columns.some((column) => column.name === opened.source) ? {} : { sourceColumn: opened.source }),
      });
    }
  }
  return out;
}

export function addOnKitRoutes(deps: AddOnKitDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/add-ons/:key/kit',
      { preHandler: [app.requireAuth], schema: { params: z.object({ key: z.string().min(1).max(64) }), response: { 200: addOnKitReply } } },
      async (request) => {
        const { key } = request.params;
        const row = await deps.meta.db.selectFrom('adminium_manifests').select(['manifest', 'status', 'connectionId']).where('manifestKey', '=', key).where('kind', '=', 'add-on').executeTakeFirst();
        const parsed = row === undefined ? null : addOnManifestSchema.safeParse(typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest);
        // Not there, switched off, being changed, or with no tables of its own on any database: one answer.
        if (row === undefined || parsed?.success !== true || row.status !== 'installed' || row.connectionId === null) {
          throw new NotFoundError('This add-on has no pages to serve here.', { addOn: key });
        }
        const manifest = parsed.data as unknown as AddOnManifest;
        const connectionId = row.connectionId;
        const reader = request.user === null || request.user === undefined ? undefined : (await userPrefsRepo(deps.meta).resolve(request.user.id)).locale;
        const view = await factsViewFor(deps.meta, connectionId, reader);
        if (view === null) throw new NotFoundError('This add-on has no pages to serve here.', { addOn: key });
        const readView = await readViewFor(request, view);
        const permissions = await request.server.rbac.resolve(request);
        const roles = await rolesOf(deps.meta, permissions);
        const records = await appTablesRepo(deps.meta).forConnection(connectionId);
        const index = { records, tables: view.model.tables.map((table) => ({ id: table.id, name: table.name })) };
        const can = (permission: string): Promise<boolean> => request.can(permission);

        const tables: z.infer<typeof addOnKitReply>['tables'] = {};
        for (const record of records) {
          if (record.appKey !== key || (record.state !== 'created' && record.state !== 'adopted')) continue;
          const model = view.model.tables.find((table) => table.name === record.tableName);
          if (model === undefined) continue;
          let table;
          try {
            table = view.table(model.id);
          } catch {
            // A table that is there and not served: as one not made yet.
            continue;
          }
          const grant = (action: string): Promise<boolean> => can(`table:${connectionId}:${table.id}:${action}`);
          const states = table.table?.states;
          const actions = states === undefined ? undefined : await stateActionFacts(deps.meta, { can, permissions, locale: reader, log: request.log }, view, table.id);
          tables[record.ref] = {
            id: table.id,
            can: { read: await grant('read'), create: await grant('create'), update: await grant('update'), delete: await grant('delete') },
            unreadable: [...readView.table(table.id).columns.values()].filter((column) => column.unreadable === true).map((column) => column.name),
            ...(states === undefined
              ? {}
              : {
                  states: {
                    column: states.column,
                    moves: movesFor(states.moves, roles),
                    ...(actions === undefined ? {} : { actions: actions.map((action) => ({ id: action.id, kind: action.kind, from: action.from, ...(action.notBy === undefined ? {} : { notBy: action.notBy }), ...(action.by === undefined ? {} : { by: action.by }) })) }),
                  },
                }),
          };
        }

        // A table of the add-on's own that posts into its ledger is its table, listed above — not a host.
        const own = new Set(Object.values(tables).map((table) => table.id));
        const hosts: z.infer<typeof addOnKitReply>['hosts'] = hostTablesOf(view, key, manifest).filter((host) => !own.has(host.id)).map((host) => {
          const table = view.table(host.id);
          return { tableRef: storedTableRef(index, host.id), id: host.id, label: table.table?.label ?? table.name, via: host.via };
        });

        // A forms add-on: the tables its forms may become a row of (see the header).
        if (formsOf(manifest) !== null) hosts.push(...(await formsHosts(deps.meta, connectionId, view, index, own, can)));

        const has: Record<string, boolean> = { [SCHEMA_REMAP]: await can(SCHEMA_REMAP) };
        // A forms add-on's "Send by e-mail" starts a campaign, which needs the e-mail screens' grant: the page says who may.
        if (formsOf(manifest) !== null) has[SETTINGS_MANAGE] = await can(SETTINGS_MANAGE);
        for (const page of manifest.addOn.pages ?? []) has[addOnPagePermission(page.ref)] = await can(addOnPagePermission(page.ref));
        const connection = await deps.meta.db.selectFrom('adminium_connections').select('currency').where('id', '=', connectionId).executeTakeFirst();
        return { connectionId, tables, hosts, has, currency: connection?.currency ?? null };
      },
    );
  };
}
