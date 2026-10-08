// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How an app fits together, as the Designer's Architecture tab draws it.
 *
 * Built from what the ENGINE applied, never from the folder: the installed
 * manifest, the app's real tables and their row counts, its roles and what
 * they are granted, what its customers may reach, its emails and its add-ons,
 * and the screens each side lists. The folder is read once more, only to say
 * which parts have changed and are not applied yet.
 *
 * Sentences and labels are made here in English from the manifest; the page
 * translates its own words around them.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseDatabaseModel } from '@adminium/engine';
import type { AppManifest } from '@adminium/manifest';
import { appTablesRepo, permissionsRepo, rolesRepo, snapshotsRepo, type InstalledManifest, type MetaDb, type TableActions } from '@adminium/meta';

import type { AppAddOnRow } from '../apps/add-ons.js';
import { accessInWords, checkApp } from '../project/apps/check-app.js';
import { APPS_DIR } from '../project/apps/read-app.js';
import { nameFromKey } from '../project/apps/scaffold-app.js';
import { readSideNav } from '../project/apps/side-build.js';

/** How long one table's row count may take before it is left out. */
export const COUNT_TIMEOUT_MS = 5000;

/** The six things every app gets from Adminium, drawn as tiles. */
export const BUILT_IN = ['sign-in', 'files', 'automations', 'import-export', 'reports', 'api'] as const;

export type UseKind = 'dashboard' | 'staff' | 'customer';
export type EdgeKind = 'session' | 'customer-key' | 'uses' | 'relation' | 'add-on' | 'email';
export type Cell = 'read' | 'write' | 'none';

export interface ArchitectureTable {
  id: string;
  ref: string;
  /** The table in the database. */
  name: string;
  rows: number | null;
  columns: { name: string; type: string }[];
  /** Tables this one points at (a foreign key), by ref. */
  relations: { to: string; column: string }[];
  /** The ledgers of add-ons this table's rows post into. */
  posts?: { addOn: string; ledger: string; action: string }[];
}

export interface ArchitectureDocument {
  /** The app's name, from its manifest. */
  name: string;
  applied: boolean;
  people: { id: string; kind: 'role' | 'customers'; label: string }[];
  uses: { id: UseKind; label: string; count: number }[];
  tables: ArchitectureTable[];
  addOns: { id: string; key: string; name: string; need: 'required' | 'suggested'; state: 'installed' | 'not-installed'; version: string | null; reason: string }[];
  builtIn: (typeof BUILT_IN)[number][];
  emails: { id: string; key: string; name: string; when: string }[];
  /** `reads`/`writes`: what a customer key may do on a table, for the line's label (worded by the page). */
  /** `does`: what a table's line to an add-on stands for: its rows post into the add-on's ledger, or the add-on prices them. */
  edges: { id: string; from: string; to: string; kind: EdgeKind; reads?: number; writes?: number; does?: 'posts' | 'prices' }[];
  lists: {
    pages: { ref: string; name: string; kind: string; shows: string }[];
    roles: { tables: string[]; rows: { id: string; role: string; cells: Cell[]; notes: (string | null)[] }[] };
    access: string[];
    screens: { id: string; name: string; side: 'staff' | 'customer' }[];
  };
  /** Parts of the folder that differ from what is applied. */
  pending: { part: string; node: string | null }[];
}

export interface ArchitectureDeps {
  meta: MetaDb;
  root: string;
  version: string;
  /** The installed apps' rows and documents. */
  manifests: () => Promise<InstalledManifest[]>;
  addOnRows: (manifest: AppManifest, connectionId: string | null) => Promise<AppAddOnRow[]>;
  /** One table's row count; rejects when it cannot be counted. */
  count: (connectionId: string, table: string) => Promise<number>;
}

const label = (value: unknown, fallback: string): string => {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['fallback'] === 'string') return record['fallback'];
    if (typeof record['en'] === 'string') return record['en'];
    const first = Object.values(record).find((entry) => typeof entry === 'string');
    if (typeof first === 'string') return first;
  }
  return fallback;
};

async function counted(count: ArchitectureDeps['count'], connectionId: string, table: string): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      count(connectionId, table),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), COUNT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The tables a page shows: its bindings, else the table its config names. */
function pageShows(page: NonNullable<AppManifest['pages']>[number]): string[] {
  const bound = Object.values(page.bindings ?? {});
  if (bound.length > 0) return [...new Set(bound)];
  const config = page.config ?? {};
  const source = (config['source'] ?? null) as { table?: unknown } | null;
  const table = typeof config['table'] === 'string' ? config['table'] : typeof source?.table === 'string' ? source.table : null;
  return table === null ? [] : [table];
}

type Producer = NonNullable<NonNullable<AppManifest['outbox']>['producers']>[number];

/** A producer's trigger: on a new row, on a change, or ahead of a date. */
function trigger(producer: Producer): { table: string; words: string } {
  const p = producer as unknown as Record<string, unknown>;
  const due = producer.due === undefined ? '' : ` (${String(producer.due.days)} days after ${producer.due.date})`;
  const created = p['onCreate'] as { table: string } | undefined;
  if (created !== undefined) return { table: created.table, words: `a ${created.table} row is added${due}` };
  const changed = p['onChange'] as { table: string; column?: string; to?: unknown } | undefined;
  if (changed !== undefined) {
    if (changed.column !== undefined) {
      const to = Array.isArray(changed.to) ? changed.to.join(' or ') : String(changed.to);
      return { table: changed.table, words: `${changed.table}.${changed.column} becomes ${to}${due}` };
    }
    return { table: changed.table, words: `a ${changed.table} row changes${due}` };
  }
  const before = p['before'] as { table: string; at: string } | undefined;
  if (before !== undefined) return { table: before.table, words: `ahead of ${before.table}.${before.at}` };
  return { table: '', words: 'a row changes' };
}

function producersOf(manifest: AppManifest, templateKey: string): Producer[] {
  const outbox = manifest.outbox;
  if (outbox === undefined) return [];
  const kinds = Object.entries(outbox.kinds).filter(([, template]) => template === templateKey).map(([kind]) => kind);
  return (outbox.producers ?? []).filter((producer) => kinds.includes(producer.kind));
}

/** When an email goes, in words, from the producers that queue its kind. */
function emailWhen(manifest: AppManifest, templateKey: string): string {
  if (manifest.outbox === undefined) return '';
  const said = producersOf(manifest, templateKey).map((producer) => trigger(producer).words);
  return said.length === 0 ? 'Sent by hand' : `When ${said.join('; or when ')}`;
}

/** The tables a producer reads from, by ref: where its email's line starts. */
function emailSources(manifest: AppManifest, templateKey: string): string[] {
  if (manifest.outbox === undefined) return [];
  const tables = producersOf(manifest, templateKey).map((producer) => trigger(producer).table).filter((table) => table !== '');
  return [...new Set(tables.length === 0 ? [manifest.outbox.table] : tables)];
}

function cellOf(actions: TableActions | undefined): { cell: Cell; note: string | null } {
  if (actions === undefined || !actions.read) return { cell: 'none', note: null };
  const writes = actions.create || actions.update || actions.delete;
  const notes: string[] = [];
  if (actions.readLimit !== undefined) notes.push('some columns hidden');
  if (writes && !actions.delete) notes.push('no delete');
  if (writes && actions.updateLimit !== undefined) notes.push(`changes ${actions.updateLimit.writable.join(', ')} only`);
  return { cell: writes ? 'write' : 'read', note: notes.length === 0 ? null : notes.join(', ') };
}

/** What differs between the folder and what is applied, part by part. */
function pendingParts(applied: AppManifest, folder: AppManifest | null): ArchitectureDocument['pending'] {
  if (folder === null) return [];
  const out: ArchitectureDocument['pending'] = [];
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const byKey = <T>(list: readonly T[] | undefined, key: (item: T) => string): Map<string, T> => new Map((list ?? []).map((item) => [key(item), item]));
  const compare = <T>(was: readonly T[] | undefined, now: readonly T[] | undefined, key: (item: T) => string, part: (k: string, item: T) => string, node: (k: string) => string | null): void => {
    const before = byKey(was, key);
    const after = byKey(now, key);
    for (const k of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const item = after.get(k) ?? before.get(k);
      if (item !== undefined && !same(before.get(k), after.get(k))) out.push({ part: part(k, item), node: node(k) });
    }
  };
  compare(applied.requiredSchema?.tables, folder.requiredSchema?.tables, (table) => table.ref, (ref) => `Table ${ref}`, (ref) => `t_${ref}`);
  compare(applied.pages, folder.pages, (page) => page.ref, (_ref, page) => `Page ${label(page.title, page.ref)}`, () => 'dashboard');
  compare(applied.roles, folder.roles, (role) => role.key, (_key, role) => `Role ${role.name}`, (key) => `r_${key}`);
  compare(applied.emailTemplates, folder.emailTemplates, (template) => template.key, (_key, template) => `Email ${label(template.name, template.key)}`, (key) => `e_${key}`);
  if (!same(applied.publicAccess, folder.publicAccess)) out.push({ part: 'Customer access', node: 'customer' });
  if (!same(applied.addOns, folder.addOns)) out.push({ part: 'Add-ons', node: null });
  return out;
}

export async function architectureOf(deps: ArchitectureDeps, appKey: string): Promise<ArchitectureDocument> {
  const installed = (await deps.manifests()).find((entry) => entry.row.manifestKey === appKey);
  const folderCheck = existsSync(join(deps.root, APPS_DIR, appKey)) ? checkApp(deps.root, appKey, { version: deps.version }) : null;
  const empty: ArchitectureDocument = {
    // An app with no table yet has no manifest to read a name from: its key, worded, is the name.
    name: folderCheck?.manifest?.name === undefined ? nameFromKey(appKey) : label(folderCheck.manifest.name, appKey),
    applied: false,
    people: [],
    uses: [],
    tables: [],
    addOns: [],
    builtIn: [...BUILT_IN],
    emails: [],
    edges: [],
    lists: { pages: [], roles: { tables: [], rows: [] }, access: [], screens: [] },
    pending: [],
  };
  if (installed === undefined) return empty;
  const manifest = installed.document as AppManifest;
  const connectionId = installed.row.connectionId;
  const doc: ArchitectureDocument = { ...empty, name: label(manifest.name, appKey), applied: true };
  const edge = (from: string, to: string, kind: EdgeKind, counts: { reads: number; writes: number } | null = null): void => {
    doc.edges.push({ id: `${from}>${to}>${kind}`, from, to, kind, ...(counts ?? {}) });
  };

  // Tables: the manifest's, with the database's names and counts.
  const names = connectionId === null ? {} : await appTablesRepo(deps.meta).realNames(connectionId, appKey);
  const tables = manifest.requiredSchema?.tables ?? [];
  doc.tables = await Promise.all(
    tables.map(async (table) => {
      const name = names[table.ref] ?? table.ref;
      return {
        id: `t_${table.ref}`,
        ref: table.ref,
        name,
        rows: connectionId === null ? null : await counted(deps.count, connectionId, name),
        columns: table.columns.map((column) => ({ name: column.ref, type: column.type })),
        relations: table.columns.filter((column) => column.type === 'fk' && column.references !== undefined).map((column) => ({ to: column.references as string, column: column.ref })),
        ...((table.postings ?? []).length === 0 ? {} : { posts: (table.postings ?? []).map((posting) => ({ addOn: posting.into.addOn, ledger: posting.into.ledger, action: posting.into.action })) }),
      };
    }),
  );
  const refs = new Set(tables.map((table) => table.ref));
  for (const table of doc.tables) {
    for (const relation of table.relations) {
      const parent = relation.to.split('.')[0] ?? relation.to;
      if (refs.has(parent) && parent !== table.ref) edge(`t_${parent}`, table.id, 'relation');
    }
  }

  // Sides and their screens: the frontends the manifest declares, the screens their nav lists.
  const sides = new Set((manifest.frontends ?? []).filter((frontend) => frontend.kind !== 'none').map((frontend) => frontend.side));
  for (const side of ['staff', 'customer'] as const) {
    if (!sides.has(side)) continue;
    const file = join(deps.root, APPS_DIR, appKey, side, 'nav.json');
    let screens: { id: string; labels: Record<string, string> }[] = [];
    try {
      screens = existsSync(file) ? readSideNav(file, `apps/${appKey}/${side}/nav.json`) : [];
    } catch {
      screens = [];
    }
    for (const screen of screens) doc.lists.screens.push({ id: `${side}:${screen.id}`, name: screen.labels['en'] ?? screen.labels['en-US'] ?? Object.values(screen.labels)[0] ?? screen.id, side });
  }
  const pages = manifest.pages ?? [];
  doc.uses.push({ id: 'dashboard', label: 'Dashboard', count: pages.length });
  if (sides.has('staff')) doc.uses.push({ id: 'staff', label: 'Staff side', count: doc.lists.screens.filter((screen) => screen.side === 'staff').length });
  if (sides.has('customer')) doc.uses.push({ id: 'customer', label: 'Customer side', count: doc.lists.screens.filter((screen) => screen.side === 'customer').length });

  doc.lists.pages = pages.map((page) => ({ ref: page.ref, name: label(page.title, page.ref), kind: page.template, shows: pageShows(page).join(', ') }));
  for (const ref of new Set(pages.flatMap(pageShows))) if (refs.has(ref)) edge('dashboard', `t_${ref}`, 'uses');

  // People: the app's roles, from their real grants; and its customers.
  const model = connectionId === null ? null : await snapshotsRepo(deps.meta).latest(connectionId).then((snapshot) => (snapshot === null ? null : parseDatabaseModel(snapshot.schema)));
  const tableIdToRef = new Map<string, string>();
  for (const table of doc.tables) {
    const id = model?.tables.find((entry) => entry.name === table.name)?.id;
    if (id !== undefined) tableIdToRef.set(`${String(connectionId)}/${id}`, table.ref);
  }
  const permissions = permissionsRepo(deps.meta);
  const appRoles = (await rolesRepo(deps.meta).list()).filter((role) => role.appKey === appKey);
  const manifestRoles = manifest.roles ?? [];
  doc.lists.roles.tables = tables.map((table) => table.ref);
  const readByStaff = new Set<string>();
  for (const role of appRoles) {
    const key = manifestRoles.find((entry) => role.slug === `${appKey}-${entry.key}`)?.key ?? role.slug;
    const id = `r_${key}`;
    doc.people.push({ id, kind: 'role', label: role.name });
    const grants = new Map<string, TableActions>();
    let wildcard: TableActions | undefined;
    for (const row of await permissions.listForRole(role.id)) {
      if (row.resourceKind !== 'table') continue;
      if (row.resourceRef === '*' || row.resourceRef === `${String(connectionId)}/*`) wildcard = row.actions as TableActions;
      const ref = tableIdToRef.get(row.resourceRef);
      if (ref !== undefined) grants.set(ref, row.actions as TableActions);
    }
    const cells = tables.map((table) => cellOf(grants.get(table.ref) ?? wildcard));
    doc.lists.roles.rows.push({ id, role: role.name, cells: cells.map((entry) => entry.cell), notes: cells.map((entry) => entry.note) });
    if (!role.screensOnly) edge(id, 'dashboard', 'session');
    const anything = cells.some((entry) => entry.cell !== 'none');
    if (sides.has('staff') && anything) edge(id, 'staff', 'session');
    tables.forEach((table, index) => {
      if (cells[index]?.cell !== 'none') readByStaff.add(table.ref);
    });
  }
  if (sides.has('staff')) for (const ref of readByStaff) edge('staff', `t_${ref}`, 'uses');

  const access = manifest.publicAccess ?? [];
  doc.lists.access = accessInWords(manifest);
  if (sides.has('customer') || access.length > 0) {
    doc.people.push({ id: 'customers', kind: 'customers', label: 'Customers' });
    if (sides.has('customer')) edge('customers', 'customer', 'customer-key');
    for (const entry of access) {
      if (!refs.has(entry.table) || !sides.has('customer')) continue;
      const reads = entry.methods.includes('GET') ? 1 : 0;
      const writes = (entry.methods.includes('POST') ? 1 : 0) + (entry.methods.includes('PATCH') ? 1 : 0);
      edge('customer', `t_${entry.table}`, 'customer-key', { reads, writes });
    }
  }

  // Emails and add-ons.
  doc.emails = (manifest.emailTemplates ?? []).map((template) => ({ id: `e_${template.key}`, key: template.key, name: label(template.name, template.key), when: emailWhen(manifest, template.key) }));
  for (const email of doc.emails) for (const ref of emailSources(manifest, email.key)) if (refs.has(ref)) edge(`t_${ref}`, email.id, 'email');
  const rows = await deps.addOnRows(manifest, connectionId).catch(() => [] as AppAddOnRow[]);
  doc.addOns = rows.map((row) => ({
    id: `a_${row.key}`,
    key: row.key,
    name: row.name,
    need: row.need === 'requires' ? 'required' : 'suggested',
    state: row.state === 'attached' || row.state === 'installed' || row.state === 'outdated' ? 'installed' : 'not-installed',
    version: row.installedVersion ?? null,
    reason: row.reason['en'] ?? row.reason['en-US'] ?? Object.values(row.reason)[0] ?? '',
  }));
  // A table whose rows post into an add-on's ledger, or are priced by one, is joined to it; the app is joined to an add-on no table reaches.
  const shown = new Set(doc.addOns.map((addOn) => addOn.id));
  const reached = new Set<string>();
  for (const table of tables) {
    const does = new Map<string, 'posts' | 'prices'>();
    if (table.adjust !== undefined) does.set(table.adjust.by.addOn, 'prices');
    for (const posting of table.postings ?? []) does.set(posting.into.addOn, 'posts');
    for (const [key, what] of does) {
      const to = `a_${key}`;
      if (!shown.has(to)) continue;
      doc.edges.push({ id: `t_${table.ref}>${to}>add-on`, from: `t_${table.ref}`, to, kind: 'add-on', does: what });
      reached.add(to);
    }
  }
  for (const addOn of doc.addOns) if (!reached.has(addOn.id)) edge('app', addOn.id, 'add-on');

  doc.pending = pendingParts(manifest, folderCheck?.manifest ?? null);
  return doc;
}
