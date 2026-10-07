// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH TABS OF AN ADD-ON'S ROWS A RECORD HAS.
 *
 * An add-on keeps rows for rows of tables it does not own (a dish's stock
 * links, the cards used on an order) and declares a tab that lists them
 * where their owner is looked at (`addOn.recordTabs`). This says which of
 * those tabs the record page of one table shows one caller:
 *
 *  - a tab `on` a list of stored table names shows on those tables;
 *  - a tab `on: 'linked'` shows on every table a rule hands in to the add-on
 *    as the row asked about — the rule's own table when it maps the row
 *    itself, the table its link column points at when it maps that — and on
 *    a table whose price the add-on answers. A rule switched off still
 *    counts: the links are kept while it is off;
 *  - on a table an app made, only while the add-on is attached to that app
 *    and switched on for it;
 *  - only to a caller who reads the tab's own table, with what they may do
 *    to its rows, and without the columns their read does not show.
 *
 * Read from what is installed and from the rules as they stand; nothing of a
 * source database is read here.
 */
import type { RecordTab } from '@adminium/add-on-contracts';
import type { TablePrivilegeMap } from '@adminium/engine/adapter';
import type { AddOnManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import { writeRefused } from '../connections/privileges.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { ReadLimits } from '../rbac/read-limits.js';
import { columnFactsFor, type ColumnFact } from '../routes/pages/column-facts.js';
import { handedInOf } from './host-tables.js';

export interface RecordTabFact {
  addOn: string;
  id: string;
  /** The tab's name: the add-on's key for it, and its English words for a reader without them. */
  label: string;
  labelKey: string;
  /** The add-on's table whose rows the tab lists, by its id here. */
  tableId: string;
  /** The two columns that say which record a row belongs to, and the stored name of THIS page's table. */
  match: { table: string; row: string; tableRef: string };
  /** One row edited as a form (the record is the row a rule asks about), or a list. */
  mode: 'list' | 'form';
  columns: ColumnFact[];
  edit: string[];
  form: string[];
  /** What "Add" picks from: the tab table's link column, the table it picks a row of, and the column a row is shown by. */
  add: { fk: string; table: string; label: string }[];
  remove: boolean;
  actions: { id: string; label: string; labelKey: string; tableId: string; form: ColumnFact[]; can: boolean }[];
  empty: string | null;
  emptyKey: string | null;
  summary: { words: string } | null;
  can: { read: true; create: boolean; update: boolean; delete: boolean };
}

/** What this asks of what is installed: plain answers from memory (the installs every save reads). */
export interface TabInstalls {
  keys?(connectionId: string): string[];
  installed(connectionId: string, addOnKey: string): { manifest: AddOnManifest; version: string; status: string; hosts: ReadonlyMap<string, boolean> } | null;
  /** The id of one of an add-on's own tables, or null. */
  tableOf(connectionId: string, addOnKey: string, ref: string): string | null;
  /** How a table is named in another manifest's rows. */
  refOf(connectionId: string, tableId: string): string;
}

export interface RecordTabsAsker {
  can(permission: string): Promise<boolean>;
  permissions: { superAdmin?: boolean; readLimits?: ReadLimits | undefined };
  /** The reader's locale (`de_DE`); absent, en_US. */
  locale?: string | undefined;
  /** What the database's own role may write, when known. */
  rights?: TablePrivilegeMap | null | undefined;
  log?: { warn(details: object, message: string): void } | undefined;
}

type OwnTable = { ref: string; columns: readonly { ref: string; type: string; references?: string | undefined }[] };

/** The tables each add-on is handed rows of, worked out once for a set of rules: a new model object is a new set. */
const HANDED = new WeakMap<object, Map<string, ReturnType<typeof handedInOf>>>();

function handedIn(view: SnapshotView, addOnKey: string, version: string, manifest: AddOnManifest): ReturnType<typeof handedInOf> {
  const kept = HANDED.get(view.model) ?? new Map<string, ReturnType<typeof handedInOf>>();
  HANDED.set(view.model, kept);
  const at = `${addOnKey}@${version}`;
  const found = kept.get(at) ?? handedInOf(view, addOnKey, manifest);
  kept.set(at, found);
  return found;
}

/**
 * The tabs of add-ons' rows the record page of `tableId` shows this caller,
 * or undefined when there is none — and when anything here throws: a facts
 * bug leaves a record without the tab, never a page that does not load.
 */
export async function recordTabsFor(meta: MetaDb, installs: TabInstalls, asker: RecordTabsAsker, view: SnapshotView, tableId: string): Promise<RecordTabFact[] | undefined> {
  try {
    const connectionId = view.connectionId;
    const table = view.table(tableId);
    // The table as rows of other manifests name it: a rename keeps it.
    const tableRef = installs.refOf(connectionId, table.id);
    const cut = tableRef.indexOf(':');
    // The app (or add-on) that made the table; null for one the owner keeps.
    const madeBy = tableRef === table.id || cut <= 0 ? null : tableRef.slice(0, cut);
    const may = async (id: string, action: 'read' | 'create' | 'update' | 'delete'): Promise<boolean> =>
      (await asker.can(`table:${connectionId}:${id}:${action}`)) && (action === 'read' || !writeRefused(asker.rights ?? null, id, action));
    const factsOf = async (id: string, names: readonly string[]): Promise<ColumnFact[]> => {
      const block = await columnFactsFor(meta, connectionId, id, asker.locale, asker.rights, asker.permissions);
      const byName = new Map((block?.columns ?? []).map((column) => [String(column.spec['name']), column]));
      return names.flatMap((name) => byName.get(name) ?? []);
    };

    const out: RecordTabFact[] = [];
    for (const key of installs.keys?.(connectionId) ?? []) {
      const addOn = installs.installed(connectionId, key);
      if (addOn === null || addOn.status !== 'installed') continue;
      const tabs = (addOn.manifest.addOn as { recordTabs?: RecordTab[] } | undefined)?.recordTabs;
      if (tabs === undefined || tabs.length === 0) continue;
      // An app's table: only while the add-on is attached to that app, and on for it.
      if (madeBy !== null && madeBy !== key && addOn.hosts.get(madeBy) !== true) continue;
      const own = ((addOn.manifest as { requiredSchema?: { tables?: OwnTable[] } }).requiredSchema?.tables ?? []) as OwnTable[];
      const handed = handedIn(view, key, addOn.version, addOn.manifest);

      for (const tab of tabs) {
        const ways = handed.get(table.id);
        if (Array.isArray(tab.on) ? !tab.on.includes(tableRef) : ways === undefined) continue;
        const tabTable = installs.tableOf(connectionId, key, tab.table);
        if (tabTable === null || !(await may(tabTable, 'read'))) continue;
        const columns = await factsOf(tabTable, tab.columns);
        const shown = new Set(columns.map((column) => String(column.spec['name'])));
        const picks = tab.add === undefined ? [] : Array.isArray(tab.add.pick) ? tab.add.pick : [tab.add.pick];
        const declared = own.find((candidate) => candidate.ref === tab.table);
        const add: RecordTabFact['add'] = [];
        for (const pick of picks) {
          const fk = declared?.columns.find((column) => column.type === 'fk' && column.references === pick.table)?.ref;
          const picked = installs.tableOf(connectionId, key, pick.table);
          // A picker lists rows of its table: offered to who reads them.
          if (fk !== undefined && picked !== null && (await may(picked, 'read'))) add.push({ fk, table: picked, label: pick.label });
        }
        const actions: RecordTabFact['actions'] = [];
        for (const action of tab.actions ?? []) {
          const child = installs.tableOf(connectionId, key, action.child.table);
          if (child === null) continue;
          actions.push({ id: action.id, label: action.label.fallback, labelKey: action.label.key, tableId: child, form: await factsOf(child, action.child.form), can: await may(child, 'create') });
        }
        out.push({
          addOn: key,
          id: tab.id,
          label: tab.label.fallback,
          labelKey: tab.label.key,
          tableId: tabTable,
          match: { table: tab.match.table, row: tab.match.row, tableRef },
          // One row, as a form, where the record is itself the row a rule asks about; a list where it is reached by a link.
          mode: tab.form !== undefined && ways?.has('row') === true ? 'form' : 'list',
          columns,
          edit: (tab.edit ?? []).filter((name) => shown.has(name)),
          form: (tab.form ?? []).filter((name) => shown.has(name)),
          add,
          remove: tab.remove === true,
          actions,
          empty: tab.empty?.fallback ?? null,
          emptyKey: tab.empty?.key ?? null,
          summary: tab.summary === undefined ? null : { words: tab.summary.words },
          can: { read: true, create: await may(tabTable, 'create'), update: await may(tabTable, 'update'), delete: await may(tabTable, 'delete') },
        });
      }
    }
    return out.length === 0 ? undefined : out;
  } catch (error) {
    asker.log?.warn({ table: tableId, reason: error instanceof Error ? error.message : String(error) }, 'the record tabs of a table could not be worked out: the page shows none');
    return undefined;
  }
}
