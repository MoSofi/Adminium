// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORMS ADD-ONS OF AN INSTALL, WITH THEIR TABLES: each installed add-on
 * that declares `addOn.forms`, on the database it was installed on, with the
 * tables its block names (the forms, the answers, the invitations, the
 * strangers' files) and its settings table, each by its id in that
 * database's snapshot.
 *
 * What reads a forms add-on's tables as the engine (a person's data, the
 * answers' keeping sweep, the results summary) finds them here, through the
 * add-on's own record of each table: a table the add-on no longer holds
 * (uninstalled, dropped) is not found. A pure read of the meta store and
 * the snapshot: nothing is written.
 */
import { formsOf, isAddOnManifest, validateManifest, type AddOnForms, type AddOnManifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, type AppTableRecord, type MetaDb } from '@adminium/meta';

import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';

/** The column of a forms add-on's settings table that says how many months answers are kept (empty: kept until removed). */
export const ANSWERS_MONTHS_COLUMN = 'answers_months';

/** The states in which an add-on still holds a table, and the statuses in which its tables are still there. */
const HELD = new Set(['created', 'adopted', 'shared']);
const PRESENT = new Set(['installed', 'disabled']);

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading the forms add-ons never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading the forms add-ons never reads a credential');
  },
};

/** One forms add-on on one database, with its tables (null: not there). */
export interface FormsAddOnTables {
  key: string;
  /** Its name, as its manifest gives it. */
  name: string;
  connectionId: string;
  status: string;
  manifest: AddOnManifest;
  block: AddOnForms;
  forms: ResolvedTable | null;
  answers: ResolvedTable | null;
  invitations: ResolvedTable | null;
  files: ResolvedTable | null;
  settings: ResolvedTable | null;
}

/** A forms add-on as stored: its key, database, status and manifest (the tables are found per database). */
export interface StoredFormsAddOn {
  key: string;
  name: string;
  connectionId: string;
  status: string;
  manifest: AddOnManifest;
  block: AddOnForms;
}

/** Every installed (or switched-off) add-on that declares forms, oldest key first. */
export async function storedFormsAddOns(meta: MetaDb): Promise<StoredFormsAddOn[]> {
  const out: StoredFormsAddOn[] = [];
  for (const entry of await manifestsRepo(meta, NO_SECRETS).list('add-on')) {
    if (entry.row.connectionId === null || !PRESENT.has(entry.row.status)) continue;
    const read = validateManifest(entry.document);
    if (!read.ok || !isAddOnManifest(read.manifest)) continue;
    const block = formsOf(read.manifest);
    if (block === null) continue;
    const name = typeof read.manifest.name === 'string' ? read.manifest.name : entry.row.manifestKey;
    out.push({ key: entry.row.manifestKey, name, connectionId: entry.row.connectionId, status: entry.row.status, manifest: read.manifest, block });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** A table of the view, or null when it is gone. */
function tableIn(view: SnapshotView, record: AppTableRecord | undefined): ResolvedTable | null {
  if (record === undefined) return null;
  for (const name of [record.schemaName === null ? record.tableName : `${record.schemaName}.${record.tableName}`, record.tableName]) {
    try {
      return view.table(name);
    } catch {
      // Not under that name: the next spelling, or gone.
    }
  }
  return null;
}

/** The forms add-ons on one database, each with its tables as that database's snapshot has them. */
export async function formsAddOnsOn(meta: MetaDb, connectionId: string, view: SnapshotView, stored?: readonly StoredFormsAddOn[]): Promise<FormsAddOnTables[]> {
  const addOns = (stored ?? (await storedFormsAddOns(meta))).filter((one) => one.connectionId === connectionId);
  if (addOns.length === 0) return [];
  const records = await appTablesRepo(meta).forConnection(connectionId);
  return addOns.map((addOn) => {
    const of = (ref: string | undefined) => (ref === undefined ? null : tableIn(view, records.find((record) => record.appKey === addOn.key && record.ref === ref && HELD.has(record.state))));
    const settingsRef = (addOn.manifest.addOn as { settingsTable?: string }).settingsTable;
    return {
      ...addOn,
      forms: of(addOn.block.forms),
      answers: of(addOn.block.answers),
      invitations: of(addOn.block.invitations),
      files: of(addOn.block.files),
      settings: of(settingsRef),
    };
  });
}
