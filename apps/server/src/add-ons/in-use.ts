// SPDX-License-Identifier: AGPL-3.0-only
/**
 * IS ANYTHING STILL HANDING ROWS TO THIS ADD-ON?
 *
 * An add-on that keeps a ledger is posted into by rules on other tables. Two
 * kinds of rule would be left pointing at nothing if it went:
 *
 *  - a rule the OWNER drew (a posting, or a price rule) that names it, on any
 *    database, switched on or off — the owner takes it away first;
 *  - a feature of an installed app that posts into it, while the add-on is
 *    attached to that app and switched on for it — the app's feature is
 *    switched off first.
 *
 * A rule an APP ships is not the owner's to take away: it reads as "not
 * there" once the add-on is gone, and comes back with it. A feature that
 * posts nothing stops no removal.
 */
import { inIdOrder, readJson, type MetaDb } from '@adminium/meta';

export interface PostingInto {
  connectionId: string;
  /** The table's id in its database's snapshot. */
  table: string;
  /** The posting's id; `price` for the table's price rule. */
  posting: string;
}

/** Every rule the owner drew that hands rows to `key`: postings into one of its ledgers, and price rules it answers. */
export async function postingsInto(meta: MetaDb, key: string, connectionId?: string): Promise<PostingInto[]> {
  const rows = await meta.db
    .selectFrom('adminium_schema_overrides')
    .select(['connectionId', 'tableName', 'op', 'value', 'origin'])
    .where('op', 'in', ['table.postings', 'table.adjust'] as never)
    .orderBy('id', 'asc')
    .execute();
  const out: PostingInto[] = [];
  for (const row of rows) {
    // An app's own rule goes inert with the add-on and comes back with it; only the owner's holds the add-on here.
    if (row.origin === 'app') continue;
    // One database's rules, for an install of the add-on on that database.
    if (connectionId !== undefined && row.connectionId !== connectionId) continue;
    const value = readJson<{ postings?: { id?: unknown; into?: { addOn?: unknown } }[]; by?: { addOn?: unknown } } | null>(row.value);
    if (row.op === 'table.postings') {
      for (const posting of value?.postings ?? []) {
        if (posting.into?.addOn === key) out.push({ connectionId: row.connectionId, table: row.tableName, posting: typeof posting.id === 'string' ? posting.id : '' });
      }
    } else if (value?.by?.addOn === key) {
      out.push({ connectionId: row.connectionId, table: row.tableName, posting: 'price' });
    }
  }
  return out;
}

export interface FeatureInto {
  app: string;
  appName: string;
  feature: string;
}

interface AppDocument {
  name?: unknown;
  addOns?: { features?: { id?: unknown; requires?: unknown }[] };
  requiredSchema?: { tables?: { postings?: { needs?: unknown }[]; adjust?: { needs?: unknown } }[] };
}

/** Every feature of an installed app that posts into `key` (or asks it for a price) while the add-on is attached to that app and switched on there. */
export async function featuresInto(meta: MetaDb, key: string, installId?: string): Promise<FeatureInto[]> {
  // One install of the add-on when named; else every install of the key.
  let query = meta.db.selectFrom('adminium_manifests').select('id').where('kind', '=', 'add-on').where('manifestKey', '=', key);
  if (installId !== undefined) query = query.where('id', '=', installId);
  const addOns = (await query.execute()).map((row) => row.id);
  if (addOns.length === 0) return [];
  // The host installs it is switched on for: an app's other copies, on other databases, do not hold it.
  const on = new Set(
    (await meta.db.selectFrom('adminium_manifest_attachments').select(['hostInstall', 'disabledAt']).where('manifestId', 'in', addOns).execute())
      .filter((attachment) => attachment.disabledAt === null)
      .map((attachment) => attachment.hostInstall),
  );
  if (on.size === 0) return [];
  const out: FeatureInto[] = [];
  // Ids sorted, rows fetched after: a sort that carries the manifests fails on MySQL once one is larger than its sort buffer.
  const order = (await meta.db.selectFrom('adminium_manifests').select('id').where('kind', '=', 'app').orderBy('manifestKey', 'asc').execute()).map((row) => row.id);
  const apps = order.length === 0 ? [] : inIdOrder(order, await meta.db.selectFrom('adminium_manifests').select(['id', 'manifestKey', 'manifest']).where('id', 'in', order).execute());
  for (const app of apps) {
    if (!on.has(app.id)) continue;
    const document = readJson<AppDocument | null>(app.manifest);
    const needing = new Set(
      (document?.addOns?.features ?? []).flatMap((feature) => (typeof feature.id === 'string' && Array.isArray(feature.requires) && feature.requires.includes(key) ? [feature.id] : [])),
    );
    const posting = new Set<string>();
    for (const table of document?.requiredSchema?.tables ?? []) {
      for (const one of table.postings ?? []) if (typeof one.needs === 'string' && needing.has(one.needs)) posting.add(one.needs);
      if (typeof table.adjust?.needs === 'string' && needing.has(table.adjust.needs)) posting.add(table.adjust.needs);
    }
    for (const feature of [...posting].sort()) out.push({ app: app.manifestKey, appName: typeof document?.name === 'string' ? document.name : app.manifestKey, feature });
  }
  return out;
}

/** What stands in the way of removing `key`; both lists empty when nothing does. */
export async function addOnInUse(meta: MetaDb, key: string, install?: { id: string; scopeKey: string }): Promise<{ postings: PostingInto[]; features: FeatureInto[] }> {
  // A server-wide install answers for every database; a per-database one for its own.
  const database = install === undefined || install.scopeKey === 'server' ? undefined : install.scopeKey;
  return { postings: await postingsInto(meta, key, database), features: await featuresInto(meta, key, install?.id) };
}
