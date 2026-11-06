// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORMS SCOPE: which tables a form's answer may become a row of, and
 * what it may write there.
 *
 * An app opens a table to forms through a `publicAccess` entry under the
 * reserved key `forms` (`@adminium/manifest` `formsEntriesOf`). Each such
 * entry is compiled here into the very resource the public API compiles a
 * key's endpoint into (`public-api/scope.ts` `CompiledResource`): the same
 * `writable`, `writableValues`, `defaults`, `requires` and anonymous limits,
 * so the one create (`public-api/create-row.ts`) holds a form's row to the
 * same rules as the app's own public create. But no key holds it, and no
 * public route can reach it: the public API never serves an entry under the
 * key `forms` (`servedPublicEntries`).
 *
 * A forms add-on reaches the tables of the apps it is attached to and
 * switched on for, on its own database. Rebuilt when anything installed,
 * attached, switched, recorded or read moves (`addOnInstallsStamp`, the
 * stamp every add-on save reads), so an app installed, updated or removed
 * changes the scope at the next answer.
 */
import { formsEntriesOf, validateManifest, type FormsEntry } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, type MetaDb } from '@adminium/meta';

import { addOnInstallsStamp } from '../apps/add-on-tables.js';
import type { CompiledResource } from '../public-api/scope.js';
import { tableIdModelOf, tableOfReal, type LooseTableIdModel } from '../installs/table-id.js';

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading the forms scope never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading the forms scope never reads a credential');
  },
};

/** One table opened to forms, as the door writes it. */
export interface FormsTable {
  /** The app that opened it, and its short name for the table. */
  appKey: string;
  /** The install of the app that opened it: its own switches decide whether the entry is open. */
  installId: string;
  ref: string;
  connectionId: string;
  /** The table's id in the database's snapshot: what a form's "becomes" names. */
  tableId: string;
  /** What the app's entry says, read whole. */
  entry: FormsEntry;
  /** The entry compiled as the public API compiles an endpoint's resource. */
  resource: CompiledResource;
}

/** The tables of one database opened to forms, by table id, with the apps that opened them. */
export interface FormsScope {
  tables: ReadonlyMap<string, FormsTable>;
  /** The same tables by their stored name (`<app>:<table>`, as `record_table` holds it). */
  byRef: ReadonlyMap<string, FormsTable>;
}

/**
 * The table a form's "becomes" names: by its id in this database's snapshot
 * (what the builder writes), or by its stored name `<app>:<table>` (what a
 * sample file can write, as it cannot know this database's ids).
 */
export function openedTable(scope: FormsScope, table: string): FormsTable | undefined {
  return scope.tables.get(table) ?? scope.byRef.get(table);
}

export interface FormsScopesDeps {
  meta: MetaDb;
  /** A database's tables as its latest snapshot names them, with the schema a table recorded with none is in. */
  modelOf: (connectionId: string) => Promise<LooseTableIdModel | null>;
  /** The stamp that moves whenever something installed moves; the store's own by default. */
  stamp?: () => Promise<string>;
}

/** The resource an entry under the key `forms` compiles to: a create, and nothing else. */
export function formsResource(entry: FormsEntry, tableId: string, ref: string): CompiledResource {
  const anonymous = entry.anonymous;
  return {
    ref,
    table: tableId,
    actions: new Set(['create']),
    expose: [],
    filterable: new Set(),
    searchable: [],
    orderable: new Set(),
    writable: new Set(entry.writable),
    defaults: { ...entry.defaults },
    where: { fixed: null, relative: [] },
    writableValues: entry.writableValues,
    requires: entry.requires,
    writableWhen: {},
    level: 'lookup',
    onClaim: null,
    maxOpen: null,
    rank: null,
    // The door asks its own human check, bound to the form.
    humanCheck: false,
    anonymous: {
      ...(anonymous.perValue === undefined ? {} : { perValue: anonymous.perValue }),
      ...(anonymous.perKeyHour === undefined ? {} : { perKeyHour: anonymous.perKeyHour }),
      ...(anonymous.perIpHour === undefined ? {} : { perIpHour: anonymous.perIpHour }),
      plainText: entry.plainText.map((one) => ({ column: one.column, max: one.max, ...(one.digits === undefined ? {} : { digits: one.digits }) })),
    },
    requireSetting: entry.requireSetting,
    claim: null,
    visibleWith: null,
    sensitive: false,
    limit: 1,
    defaultLimit: 1,
    defaultOrder: null,
    rate: null,
    response: { shape: 'single' },
    count: 'none',
    kind: 'records',
    confirm: null,
  };
}

/** The forms scope of every database a forms add-on is on, kept until something installed moves. */
export function createFormsScopes(deps: FormsScopesDeps) {
  const stamp = deps.stamp ?? (() => addOnInstallsStamp(deps.meta));
  let kept: { stamp: string; scopes: Map<string, Promise<FormsScope>> } | null = null;

  /** The tables of one database the apps the add-on serves have opened to forms. */
  async function build(connectionId: string, addOnKey: string): Promise<FormsScope> {
    const tables = new Map<string, FormsTable>();
    const byRef = new Map<string, FormsTable>();
    const read = await deps.modelOf(connectionId);
    if (read === null) return { tables, byRef };
    const snapshot = tableIdModelOf(read);
    const entries = await manifestsRepo(deps.meta, NO_SECRETS).list();
    // The apps the add-on is attached to, and switched on for, on its own database.
    const self = entries.find((one) => one.row.kind === 'add-on' && one.row.manifestKey === addOnKey && one.row.connectionId === connectionId);
    const on = new Set((self?.attachments ?? []).filter((attachment) => attachment.disabledAt === null).map((attachment) => attachment.attachedTo));
    for (const one of entries) {
      if (one.row.kind !== 'app' || one.row.status !== 'installed' || one.row.connectionId !== connectionId || !on.has(one.row.manifestKey)) continue;
      const read = validateManifest(one.document, { allowLocalPublisher: true });
      if (!read.ok || read.manifest.kind !== 'app') continue;
      const opened = formsEntriesOf(read.manifest);
      if (opened.length === 0) continue;
      const names = await appTablesRepo(deps.meta).realNames(connectionId, one.row.manifestKey);
      for (const entry of opened) {
        const real = names[entry.table];
        const table = real === undefined ? undefined : tableOfReal(snapshot, real);
        if (table === undefined) continue;
        const ref = `forms:${one.row.manifestKey}:${entry.table}`;
        const opened: FormsTable = { appKey: one.row.manifestKey, installId: one.row.id, ref: entry.table, connectionId, tableId: table.id, entry, resource: formsResource(entry, table.id, ref) };
        tables.set(table.id, opened);
        byRef.set(`${one.row.manifestKey}:${entry.table}`, opened);
      }
    }
    return { tables, byRef };
  }

  return {
    /** The forms scope a forms add-on on a database writes through, as it stands now. */
    async scopeFor(connectionId: string, addOnKey: string): Promise<FormsScope> {
      const now = await stamp();
      if (kept?.stamp !== now) kept = { stamp: now, scopes: new Map() };
      const id = `${connectionId}\u0000${addOnKey}`;
      let scope = kept.scopes.get(id);
      if (scope === undefined) {
        scope = build(connectionId, addOnKey);
        const holder = kept;
        holder.scopes.set(id, scope);
        // A read that failed is not kept: the next answer reads again.
        scope.catch(() => holder.scopes.delete(id));
      }
      return scope;
    },
  };
}

export type FormsScopes = ReturnType<typeof createFormsScopes>;
