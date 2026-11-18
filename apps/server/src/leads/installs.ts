// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ADD-ONS THAT FIND PEOPLE, AS THE ENGINE KEEPS WHAT THEY FOUND.
 *
 *  - WHERE: each installed (or switched-off) add-on that declares
 *    `addOn.leads`, on the database it was installed on, with its found
 *    people table, its fields' sources table, its one settings row and the
 *    outbox that sends its tell mail (the outbox kind `tell`), found through
 *    the add-on's own record of each table (a table it no longer holds is not
 *    found). A pure read of the meta store and the snapshot.
 *  - WHO WRITES ({@link leadsOwnTable}): Adminium alone writes the found
 *    people and the fields' sources; a person's create, change or delete of
 *    one, through any door, is refused (`compose.ts`), as a chat's
 *    conversations are. Only the engine's own paths write them: a person
 *    kept, their tell mail sent, an erasure, the keeping sweep.
 *  - THE SETTINGS ({@link readLeadsSettings}): whether people are kept at
 *    all, why (one plain sentence per language), and for how many years. A
 *    settings row not made yet reads as people off.
 */
import { formLanguageSchema, wordsSchema, type Words } from '@adminium/add-on-contracts/forms';
import {
  FOUND_PERSON_PURPOSE_MAX,
  LEADS_KEEP_YEARS_DEFAULT,
  LEADS_KEEP_YEARS_MAX,
  LEADS_KEEP_YEARS_MIN,
  isAddOnManifest,
  leadsOf,
  validateManifest,
  type AddOnLeads,
  type AddOnManifest,
  type Outbox,
} from '@adminium/manifest';
import { appOutboxesRepo, appTablesRepo, manifestsRepo, realTableOf, type AppTableRecord, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';

/** The outbox kind a found person's tell mail is sent as. */
export const LEADS_TELL_KIND = 'tell';

/** The states in which an add-on still holds a table, and the statuses in which its tables are still there. */
const HELD = new Set(['created', 'adopted', 'shared']);
const PRESENT = new Set(['installed', 'disabled']);

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading the add-ons that find people never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading the add-ons that find people never reads a credential');
  },
};

/** Whether a table is one of the tables an add-on keeps what it found in, which Adminium alone writes. */
export function leadsOwnTable(installs: AddOnInstalls, connectionId: string, tableId: string): boolean {
  for (const key of installs.keys?.(connectionId) ?? []) {
    const installed = installs.installed(connectionId, key);
    const block = installed === null ? null : leadsOf(installed.manifest);
    if (block === null) continue;
    for (const ref of [block.foundPeople, block.fieldSources]) if (installs.tableOf(connectionId, key, ref) === tableId) return true;
  }
  return false;
}

/** An add-on that finds people, as stored: its key, install, database, status and manifest. */
export interface StoredLeadsAddOn {
  key: string;
  /** Its install's id (`adminium_manifests`). */
  installId: string;
  name: string;
  connectionId: string;
  status: string;
  manifest: AddOnManifest;
  block: AddOnLeads;
}

/** The outbox that sends a found person's tell mail: its table and its stored definition (real table names). */
export interface TellOutbox {
  table: ResolvedTable;
  definition: Outbox;
  /** The outbox's link column to the found people table. */
  link: string;
}

/** One such add-on on one database, with its tables (null: not there). */
export interface LeadsAddOnTables extends StoredLeadsAddOn {
  foundPeople: ResolvedTable | null;
  fieldSources: ResolvedTable | null;
  settings: ResolvedTable | null;
  tell: TellOutbox | null;
}

/** Every installed (or switched-off) add-on that declares leads, by key. */
export async function storedLeadsAddOns(meta: MetaDb): Promise<StoredLeadsAddOn[]> {
  const out: StoredLeadsAddOn[] = [];
  for (const entry of await manifestsRepo(meta, NO_SECRETS).list('add-on')) {
    if (entry.row.connectionId === null || !PRESENT.has(entry.row.status)) continue;
    const read = validateManifest(entry.document);
    if (!read.ok || !isAddOnManifest(read.manifest)) continue;
    const block = leadsOf(read.manifest);
    if (block === null) continue;
    const name = typeof read.manifest.name === 'string' ? read.manifest.name : entry.row.manifestKey;
    out.push({ key: entry.row.manifestKey, installId: entry.row.id, name, connectionId: entry.row.connectionId, status: entry.row.status, manifest: read.manifest, block });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.installId.localeCompare(b.installId));
}

function tableIn(view: SnapshotView, record: AppTableRecord | undefined): ResolvedTable | null {
  if (record === undefined) return null;
  try {
    return view.table(realTableOf(record));
  } catch {
    return null;
  }
}

/** A table of the view by its id, or null when it is gone. */
function tableById(view: SnapshotView, id: string): ResolvedTable | null {
  try {
    return view.table(id);
  } catch {
    return null;
  }
}

/** The add-on's outbox, when it sends the tell mail through a link to its found people table. */
async function tellOutboxOf(meta: MetaDb, addOn: StoredLeadsAddOn, view: SnapshotView, foundPeople: ResolvedTable | null): Promise<TellOutbox | null> {
  if (foundPeople === null) return null;
  const stored = await appOutboxesRepo(meta).findOnConnection(addOn.key, addOn.connectionId);
  if (stored === null) return null;
  let definition: Outbox;
  try {
    definition = JSON.parse(stored.definition) as Outbox;
  } catch {
    return null;
  }
  if (definition.kinds[LEADS_TELL_KIND] === undefined) return null;
  const table = tableById(view, definition.table);
  if (table === null || table.primaryKey.length !== 1) return null;
  const link = Object.values(definition.links ?? {}).find((column) =>
    view.model.relations.some((relation) => relation.through === null && relation.from.tableId === table.id && relation.from.columns.length === 1 && relation.from.columns[0] === column && relation.to.tableId === foundPeople.id),
  );
  return link === undefined ? null : { table, definition, link };
}

/** The add-ons that find people on one database, each with its tables as that database's snapshot has them. */
export async function leadsAddOnsOn(meta: MetaDb, connectionId: string, view: SnapshotView, stored?: readonly StoredLeadsAddOn[]): Promise<LeadsAddOnTables[]> {
  const addOns = (stored ?? (await storedLeadsAddOns(meta))).filter((one) => one.connectionId === connectionId);
  if (addOns.length === 0) return [];
  const records = await appTablesRepo(meta).forConnection(connectionId);
  const out: LeadsAddOnTables[] = [];
  for (const addOn of addOns) {
    const of = (ref: string | undefined) => (ref === undefined ? null : tableIn(view, records.find((record) => record.appKey === addOn.key && record.ref === ref && HELD.has(record.state))));
    const foundPeople = of(addOn.block.foundPeople);
    const settingsRef = (addOn.manifest.addOn as { settingsTable?: string }).settingsTable;
    out.push({ ...addOn, foundPeople, fieldSources: of(addOn.block.fieldSources), settings: of(settingsRef), tell: await tellOutboxOf(meta, addOn, view, foundPeople) });
  }
  return out;
}

/** What the engine reads of an add-on's settings row. */
export interface LeadsSettings {
  /** Whether people are found and kept at all. */
  peopleOn: boolean;
  /** Why found people are kept: one plain sentence per language, as written. */
  purpose: Words;
  /** How many years a found person is kept (1 to 10). */
  keepYears: number;
  /** The keeping time as stored, null when it is not one the engine takes. */
  keepYearsSet: number | null;
}

/** A JSON value as a database hands it back: parsed (Postgres, MySQL) or as text (SQLite). */
function parsedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** A yes/no as a database hands it back. */
function yes(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

/** The purpose, as Words: only the versions that are one plain sentence in one of the eight languages. */
export function purposeOf(value: unknown): Words {
  const parsed = parsedJson(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Words = {};
  const one = wordsSchema(FOUND_PERSON_PURPOSE_MAX);
  for (const [language, text] of Object.entries(parsed as Record<string, unknown>)) {
    if (!formLanguageSchema.safeParse(language).success || typeof text !== 'string') continue;
    const checked = one.safeParse({ [language]: text.trim() });
    if (checked.success && plainSentence(text)) Object.assign(out, checked.data);
  }
  return out;
}

/** A sentence that holds no link of any kind: the purpose goes in a service mail, which must offer nothing to follow. */
export function plainSentence(text: string): boolean {
  return !/(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\bmailto:|@[^\s@]+\.[a-z]{2,}|\b[a-z0-9-]+\.(?:com|net|org|io|co|uk|fr|de|no|dk|cz|eg|cn|tw|example)\b)/i.test(text);
}

/** The settings as a row holds them (null: no row yet, which reads as people off). */
export function readLeadsSettingsRow(row: Row | null): LeadsSettings {
  if (row === null) return { peopleOn: false, purpose: {}, keepYears: LEADS_KEEP_YEARS_DEFAULT, keepYearsSet: null };
  const raw = row['keep_years'];
  const years = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : typeof raw === 'bigint' ? Number(raw) : null;
  const set = years !== null && Number.isInteger(years) && years >= LEADS_KEEP_YEARS_MIN && years <= LEADS_KEEP_YEARS_MAX ? years : null;
  return { peopleOn: yes(row['people_on']), purpose: purposeOf(row['purpose']), keepYears: set ?? LEADS_KEEP_YEARS_DEFAULT, keepYearsSet: set };
}

/** The add-on's one settings row, as it stands (null: not made yet). */
export async function leadsSettingsRow(db: Kysely<SourceDatabase>, addOn: Pick<LeadsAddOnTables, 'settings'>): Promise<Row | null> {
  const settings = addOn.settings;
  if (settings === null) return null;
  let query = db.selectFrom(settings.id as never).selectAll();
  for (const column of settings.primaryKey) query = query.orderBy(sql.ref(column) as never);
  return ((await query.limit(1).executeTakeFirst()) as Row | undefined) ?? null;
}

/** The add-on's settings, as it reads them now. */
export async function readLeadsSettings(db: Kysely<SourceDatabase>, addOn: Pick<LeadsAddOnTables, 'settings'>): Promise<LeadsSettings> {
  return readLeadsSettingsRow(await leadsSettingsRow(db, addOn));
}
