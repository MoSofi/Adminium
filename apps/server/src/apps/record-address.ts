// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A RECORD OPENS: the app's own screen for it, when its app says one.
 *
 * An app's manifest may say, per table, the address under its staff side
 * where a record of that table opens (`frontends[].records`,
 * `{ "deals": "/deals/{id}" }`). Wherever the server gives a person a link to
 * a record (a notice, the notice's e-mail, a search hit) it asks here first,
 * and keeps the dashboard's record page when this answers nothing.
 *
 * ── WHO GETS THE APP'S ADDRESS ─────────────────────────────────────────────
 * Somebody whose roles open the app's staff side (`app:<key>:staff`), while
 * the app is switched on, the side is not switched off and the table's part
 * of the app is on. Everybody else keeps the dashboard's page, which is the
 * one they can open. The address is asked for one person at a time: two
 * people told of the same record may be sent to two places.
 *
 * ── WHAT THE ADDRESS IS MADE OF ────────────────────────────────────────────
 * Never of anything the manifest could aim elsewhere. The base is the side's
 * own: the app's mount on this server (`/apps/<key>/staff`), an extra
 * tenant's mount, the dashboard's frame for a side shown inside it
 * (`/a/<key>`), or the host the operator mapped to the side. The path is
 * the manifest's, read again here (`recordAddressOf`): plain segments and the
 * record's id as one segment. A stored address that is not one answers
 * nothing. The host of an e-mail's link is the operator's mapped host or
 * `system.publicOrigin`, never a request's.
 */
import { recordAddressOf, staffRecordAddresses } from '@adminium/manifest';
import { readBool, settingsRepo, type MetaDb } from '@adminium/meta';

import { SURFACES_URL_ROOT } from '../cli/surfaces-root.js';
import { loadAppParts, partIsOn } from '../rbac/app-parts.js';
import { permissionSetAllows, resolvePermissionSet, type PermissionSet } from '../rbac/resolver.js';
import { availabilityOf, instancesOf, staffConnectionOf, staffPlacementOf, type SurfaceSettings } from '../surfaces/settings.js';

/** The record a link is about, as a notice's `entity` and a search hit name it. */
export interface RecordAt {
  connectionId: string;
  /** The table's id in the snapshot: `crm_deals`, or `public.crm_deals`. */
  table: string;
  /** The record's id as the dashboard's record page takes it (`pkLabel`). */
  recordId: string;
}

export interface RecordPlace {
  appKey: string;
  /** The address under the staff side: `/deals/12`. An app's own screen routes on it. */
  path: string;
  /** The address on this server: `/apps/crm/staff/deals/12`, or `/a/crm/deals/12` for a side shown inside the dashboard. */
  url: string;
  /** The host the operator mapped to the side, when there is one: an e-mail's link starts there. */
  host: string | null;
}

interface AppAddresses {
  appKey: string;
  /** Real table name → the address its records open at, with the part of the app the table belongs to. */
  tables: Map<string, { address: string; schema: string | null; module: string | null; owned: boolean }>;
  /** The base of the mount that reads this connection, on this server. */
  base: string;
  host: string | null;
}

/** The addresses an installed app's manifest declares, kept until the row is written again. */
const declared = new Map<string, { stamp: string; addresses: Readonly<Record<string, string>> }>();

function parse(value: unknown): unknown {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

/** The record's id out of a notice's `pk`, as `pkLabel` writes it: the one value, or the values as JSON. */
export function recordIdOf(pk: unknown): string | null {
  if (typeof pk !== 'object' || pk === null) return null;
  const values = Object.values(pk as Record<string, unknown>);
  if (values.length === 0 || values.some((value) => value === null || value === undefined)) return null;
  return values.length === 1 ? String(values[0]) : JSON.stringify(values);
}

async function surfaceSettings(meta: MetaDb): Promise<SurfaceSettings> {
  const settings = settingsRepo(meta);
  const [apps, domains, rows] = await Promise.all([
    settings.get('surfaces.apps'),
    settings.get('surfaces.domains'),
    meta.db.selectFrom('adminium_manifests').select(['manifestKey', 'status']).where('kind', '=', 'app').execute(),
  ]);
  return {
    apps: (apps ?? {}) as SurfaceSettings['apps'],
    domains: (domains ?? {}) as SurfaceSettings['domains'],
    statuses: Object.fromEntries(rows.map((row) => [row.manifestKey, row.status === 'installed' || row.status === 'installing' || row.status === 'disabled' ? row.status : 'error'])) as SurfaceSettings['statuses'],
  };
}

/**
 * The addresses of every app on one database: read once, asked many times
 * (a search asks for each hit; a notice asks once).
 */
export interface RecordAddressBook {
  /** Where the record opens, whoever asks: null when no app says. */
  placeOf(record: RecordAt): RecordPlace | null;
  /** The same for a person: null unless their roles open that app's staff side. */
  placeFor(set: PermissionSet, record: RecordAt): RecordPlace | null;
}

/** The book of a database no app gives an address on. */
export const NO_ADDRESSES: RecordAddressBook = { placeOf: () => null, placeFor: () => null };

export async function recordAddressBook(meta: MetaDb, connectionId: string, given?: SurfaceSettings): Promise<RecordAddressBook> {
  const rows = await meta.db
    .selectFrom('adminium_manifests')
    .select(['id', 'manifestKey', 'connectionId', 'version', 'updatedAt'])
    .where('kind', '=', 'app')
    .where('status', '=', 'installed')
    .execute();
  if (rows.length === 0) return NO_ADDRESSES;
  const settings = given ?? (await surfaceSettings(meta));
  const apps: AppAddresses[] = [];
  const parts = await loadAppParts(meta, rows.map((row) => row.manifestKey));

  for (const row of [...rows].sort((a, b) => a.manifestKey.localeCompare(b.manifestKey))) {
    const key = row.manifestKey;
    // The mount that reads this database: the app's own, or one extra tenant's.
    const own = staffConnectionOf(settings, key) ?? row.connectionId;
    const instance = own === connectionId ? null : (instancesOf(settings, key).find((entry) => entry.connectionId === connectionId)?.slug ?? undefined);
    if (instance === undefined) continue;
    if (availabilityOf(settings, key, 'staff') !== 'ok') continue;

    const stamp = `${row.version}:${String(row.updatedAt)}`;
    let known = declared.get(row.id);
    if (known === undefined || known.stamp !== stamp) {
      const stored = await meta.db.selectFrom('adminium_manifests').select('manifest').where('id', '=', row.id).executeTakeFirst();
      known = { stamp, addresses: staffRecordAddresses(parse(stored?.manifest)) };
      declared.set(row.id, known);
    }
    if (Object.keys(known.addresses).length === 0) continue;

    const tableRows = await meta.db
      .selectFrom('adminium_app_tables')
      .select(['ref', 'tableName', 'schemaName', 'module', 'state', 'owned'])
      .where('connectionId', '=', connectionId)
      .where('appKey', '=', key)
      .where('state', 'in', ['created', 'adopted', 'shared'])
      .execute();
    const tables: AppAddresses['tables'] = new Map();
    for (const table of tableRows) {
      const address = known.addresses[table.ref];
      // A table of a part that is off opens nowhere in the app: its screens are off with it.
      if (address === undefined || !partIsOn(parts.get(key), table.module)) continue;
      tables.set(table.tableName, { address, schema: table.schemaName, module: table.module, owned: readBool(table.owned) });
    }
    if (tables.size === 0) continue;

    const host = Object.entries(settings.domains).find(([, target]) => target.appKey === key && target.side === 'staff' && target.instance === (instance ?? undefined))?.[0] ?? null;
    const base =
      instance !== null
        ? `${SURFACES_URL_ROOT}/${key}/${instance}/staff`
        : staffPlacementOf(settings, key) === 'internal'
          ? `/a/${key}`
          : `${SURFACES_URL_ROOT}/${key}/staff`;
    apps.push({ appKey: key, tables, base, host });
  }
  if (apps.length === 0) return NO_ADDRESSES;

  /*
   * A table two apps use (one made it, the other shares it) may be given an
   * address by both. The app that made the table says where its records
   * open; with no such app, the first by key, so the answer never changes
   * from one request to the next.
   */
  const placeOf = (record: RecordAt): RecordPlace | null => {
    if (record.connectionId !== connectionId) return null;
    let shared: RecordPlace | null = null;
    for (const app of apps) {
      for (const [name, table] of app.tables) {
        const named = table.schema !== null ? record.table === `${table.schema}.${name}` || record.table === name : record.table === name || record.table.endsWith(`.${name}`);
        if (!named) continue;
        const path = recordAddressOf(table.address, record.recordId);
        if (path === null) continue;
        const place = { appKey: app.appKey, path, url: `${app.base}${path}`, host: app.host };
        if (table.owned) return place;
        shared ??= place;
      }
    }
    return shared;
  };
  return {
    placeOf,
    placeFor(set, record) {
      const place = placeOf(record);
      return place !== null && permissionSetAllows(set, `app:${place.appKey}:staff`) ? place : null;
    },
  };
}

/** Where a record opens for one person: the app's own screen when their roles open it, else null. */
export async function recordPlaceForUser(meta: MetaDb, user: { id: string; name: string }, record: RecordAt): Promise<RecordPlace | null> {
  const book = await recordAddressBook(meta, record.connectionId);
  if (book === NO_ADDRESSES) return null;
  return book.placeFor(await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.name }), record);
}

/** A notice's `entity`, read as the record it is about; null for anything else. */
export function recordOfEntity(entity: unknown): RecordAt | null {
  if (typeof entity !== 'object' || entity === null) return null;
  const { connectionId, table, pk } = entity as { connectionId?: unknown; table?: unknown; pk?: unknown };
  const recordId = recordIdOf(pk);
  if (typeof connectionId !== 'string' || typeof table !== 'string' || recordId === null) return null;
  return { connectionId, table, recordId };
}

/**
 * The link an e-mail carries to a place: on the side's own host when the
 * operator mapped one, else under the server's public address; with neither,
 * the path as it is (as a notice's link always was with no address known).
 */
export function placeLink(place: RecordPlace, origin: string | undefined): string {
  // A mapped host serves the side at its root. A side inside the dashboard has no host of its own.
  if (place.host !== null && !place.url.startsWith('/a/')) return `https://${place.host}${place.path}`;
  if (origin === undefined || origin === '') return place.url;
  return `${origin.replace(/\/+$/, '')}${place.url}`;
}

/**
 * Where each of one person's notices opens, in the order given: the app's own
 * screen for a notice about a record its app gives an address, else null (the
 * notice keeps the link it was written with). One read of the person's roles
 * and one book for each database, however many notices.
 */
export async function noticePlaces(meta: MetaDb, userId: string, entities: readonly unknown[]): Promise<(RecordPlace | null)[]> {
  const records = entities.map(recordOfEntity);
  if (records.every((record) => record === null)) return records.map(() => null);
  const books = new Map<string, RecordAddressBook>();
  let set: PermissionSet | null = null;
  const out: (RecordPlace | null)[] = [];
  for (const record of records) {
    if (record === null) {
      out.push(null);
      continue;
    }
    let book = books.get(record.connectionId);
    if (book === undefined) {
      book = await recordAddressBook(meta, record.connectionId);
      books.set(record.connectionId, book);
    }
    if (book === NO_ADDRESSES) {
      out.push(null);
      continue;
    }
    set ??= await resolvePermissionSet(meta, { kind: 'user', id: userId, label: userId });
    out.push(book.placeFor(set, record));
  }
  return out;
}
