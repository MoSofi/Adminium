// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE STORED NAME OF A TABLE inside another manifest's rows.
 *
 * An add-on's row may say which table of an app it belongs to ("this stock
 * movement is for a row of the shop's orders"). It cannot keep the table's
 * real name: that changes with a prefix, a rename, another database. So the
 * stored form is:
 *
 *  - `<maker key>:<ref>` when a manifest MADE the table (`shop:orders`): the
 *    key of the earliest record that owns it, and that manifest's own short
 *    name for it. It survives a rename, because the record follows one;
 *  - the table's id in the snapshot (`public.orders`, `main.orders`) when
 *    nobody made it — a table an app only adopted has no maker.
 *
 * This is the ONE place that writes or reads the form. Nobody else splits it.
 */
import { isAddOnManifest, validateManifest, type AddOnManifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, type AppTableRecord, type ManifestStatus, type MetaDb } from '@adminium/meta';

import { addOnInstallsStamp } from './add-on-tables.js';

export interface TableRefIndex {
  /** Every record of the connection, oldest first. */
  records: readonly AppTableRecord[];
  tables: readonly { id: string; name: string }[];
}

/** The records and tables a stored name is read against: one meta read, made before any source transaction. */
export async function tableRefIndex(meta: MetaDb, connectionId: string, model: { tables: readonly { id: string; name: string }[] }): Promise<TableRefIndex> {
  return { records: await appTablesRepo(meta).forConnection(connectionId), tables: model.tables.map((table) => ({ id: table.id, name: table.name })) };
}

/** A record that still stands for a table: not one whose table was dropped. */
const live = (record: AppTableRecord): boolean => record.state !== 'dropped';

/** The manifest that made a real table: its earliest record that owns it. None for a table nobody made. */
function makerOf(index: TableRefIndex, tableName: string): AppTableRecord | null {
  return index.records.find((record) => record.tableName === tableName && record.owned && live(record)) ?? null;
}

/**
 * The table a stored name stands for, or null when it names nothing here: a
 * key with no record, a table that was dropped, an id the database no longer
 * has. A caller treats such a row as linked to nothing.
 */
export function resolveTableRef(index: TableRefIndex, stored: string): { tableId: string; maker: string | null; ref: string | null } | null {
  // A table's id is tried first: an id may itself hold a colon on no engine Adminium reads, and an id that is one is one.
  const byId = index.tables.find((table) => table.id === stored);
  if (byId !== undefined) return { tableId: byId.id, maker: null, ref: null };
  const cut = stored.indexOf(':');
  if (cut <= 0) return null;
  const maker = stored.slice(0, cut);
  const ref = stored.slice(cut + 1);
  const record = index.records.find((candidate) => candidate.appKey === maker && candidate.ref === ref && live(candidate));
  if (record === undefined) return null;
  const table = index.tables.find((candidate) => candidate.name === record.tableName);
  // Only the maker's own name for it is a name: another manifest's record of the same table says nothing here.
  if (table === undefined || makerOf(index, record.tableName)?.id !== record.id) return null;
  return { tableId: table.id, maker, ref };
}

/** How a table is named in another manifest's rows: by who made it, else by its id. */
export function storedTableRef(index: TableRefIndex, tableId: string): string {
  const table = index.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) return tableId;
  const maker = makerOf(index, table.name);
  return maker === null ? tableId : `${maker.appKey}:${maker.ref}`;
}

// ─── what is installed, asked from inside a save ─────────────────────────────

/** An add-on as it stands on one database. */
export interface InstalledAddOn {
  manifest: AddOnManifest;
  version: string;
  /** Any status: what `installing`, `updating` or `disabled` means for a save is the asker's to say. */
  status: ManifestStatus;
  /**
   * The apps it is attached to, and whether it is switched on for each. An
   * app ABSENT from the map is not attached; an app that is there with
   * `false` is attached and switched off. The two are different answers.
   */
  hosts: ReadonlyMap<string, boolean>;
}

/**
 * What is installed where, as plain answers. Asked inside a source
 * transaction, where nothing may wait on a pool: every answer is in memory.
 */
export interface AddOnInstalls {
  installed(connectionId: string, addOnKey: string): InstalledAddOn | null;
  /** The id of one of an add-on's own tables; null unless the add-on made or took it and it is still there. */
  tableOf(connectionId: string, addOnKey: string, ref: string): string | null;
  /** How a table is named in another manifest's rows (`storedTableRef`). */
  refOf(connectionId: string, tableId: string): string;
  /** The table a stored name stands for, or null when it names nothing here. */
  tableOfRef(connectionId: string, tableRef: string): string | null;
  /** Whether a feature of an app is on: every add-on it needs is installed here, attached to the app and switched on for it. */
  featureOn(connectionId: string, appKey: string, featureId: string): boolean;
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading what is installed never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading what is installed never reads a credential');
  },
};

type ModelOf = (connectionId: string) => Promise<{ tables: readonly { id: string; name: string }[] } | null>;

/** Reads everything once; the answers never touch the store again. Rebuilt, never patched. */
export async function loadAddOnInstalls(meta: MetaDb, models: ModelOf): Promise<AddOnInstalls> {
  const manifests = await manifestsRepo(meta, NO_SECRETS).list();
  const records = appTablesRepo(meta);
  const indexes = new Map<string, TableRefIndex>();
  const connectionIds = new Set(manifests.flatMap((entry) => (entry.row.connectionId === null ? [] : [entry.row.connectionId])));
  for (const connectionId of connectionIds) {
    const model = await models(connectionId);
    indexes.set(connectionId, { records: await records.forConnection(connectionId), tables: (model?.tables ?? []).map((table) => ({ id: table.id, name: table.name })) });
  }

  const addOns = new Map<string, InstalledAddOn>();
  const features = new Map<string, readonly string[]>();
  const at = (connectionId: string, key: string): string => `${connectionId} ${key}`;
  for (const entry of manifests) {
    const connectionId = entry.row.connectionId;
    if (connectionId === null) continue;
    if (entry.row.kind === 'add-on') {
      const read = validateManifest(entry.document);
      const sound = read.ok && isAddOnManifest(read.manifest);
      addOns.set(at(connectionId, entry.row.manifestKey), {
        // A stored document that no longer reads is not "not installed": it is an add-on that cannot answer.
        manifest: sound ? (read.manifest as AddOnManifest) : ({ kind: 'add-on', key: entry.row.manifestKey } as unknown as AddOnManifest),
        version: entry.row.version,
        status: sound ? (entry.row.status as ManifestStatus) : 'error',
        hosts: new Map(entry.attachments.map((attachment) => [attachment.attachedTo, attachment.disabledAt === null])),
      });
      continue;
    }
    const declared = (entry.document as { addOns?: { features?: unknown } } | null)?.addOns?.features;
    for (const feature of Array.isArray(declared) ? declared : []) {
      const { id, requires } = feature as { id?: unknown; requires?: unknown };
      if (typeof id === 'string' && Array.isArray(requires)) features.set(at(connectionId, `${entry.row.manifestKey} ${id}`), requires.filter((key): key is string => typeof key === 'string'));
    }
  }

  const installs: AddOnInstalls = {
    installed: (connectionId, addOnKey) => addOns.get(at(connectionId, addOnKey)) ?? null,
    tableOf(connectionId, addOnKey, ref) {
      const index = indexes.get(connectionId);
      if (index === undefined || !addOns.has(at(connectionId, addOnKey))) return null;
      // Only a table it made or took: one still to be made, let go or dropped is not there to write.
      const record = index.records.find((candidate) => candidate.appKey === addOnKey && candidate.ref === ref && (candidate.state === 'created' || candidate.state === 'adopted'));
      return record === undefined ? null : (index.tables.find((table) => table.name === record.tableName)?.id ?? null);
    },
    refOf(connectionId, tableId) {
      const index = indexes.get(connectionId);
      return index === undefined ? tableId : storedTableRef(index, tableId);
    },
    tableOfRef(connectionId, tableRef) {
      const index = indexes.get(connectionId);
      return index === undefined ? null : (resolveTableRef(index, tableRef)?.tableId ?? null);
    },
    featureOn(connectionId, appKey, featureId) {
      const needs = features.get(at(connectionId, `${appKey} ${featureId}`));
      if (needs === undefined) return false;
      return needs.every((key) => {
        const addOn = addOns.get(at(connectionId, key));
        return addOn !== undefined && addOn.status === 'installed' && addOn.hosts.get(appKey) === true;
      });
    },
  };
  return installs;
}

/**
 * The one instance a process keeps. `fresh()` is asked BEFORE a source
 * transaction opens: it reads one stamp and loads again only when what is
 * installed, attached, switched, recorded or read moved — in this process or
 * another. `current()` is the last one loaded, for inside the transaction.
 */
export interface AddOnInstallsKeeper {
  fresh(): Promise<AddOnInstalls>;
  current(): AddOnInstalls;
}

const NOTHING: AddOnInstalls = { installed: () => null, tableOf: () => null, refOf: (_connectionId, tableId) => tableId, tableOfRef: () => null, featureOn: () => false };

export function keepAddOnInstalls(meta: MetaDb, models: ModelOf): AddOnInstallsKeeper {
  let kept: { stamp: string; installs: AddOnInstalls } | null = null;
  return {
    async fresh() {
      const stamp = await addOnInstallsStamp(meta);
      if (kept?.stamp !== stamp) kept = { stamp, installs: await loadAddOnInstalls(meta, models) };
      return kept.installs;
    },
    current: () => kept?.installs ?? NOTHING,
  };
}
