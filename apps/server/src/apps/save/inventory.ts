// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: WHAT A DATABASE COULD PUT IN ITS APP.
 *
 * The wizard's "What to include" lists every thing the converter would carry
 * by default (the quick save), so a person can untick some, and says what each
 * one needs, so ticking a page brings its table and unticking a table names
 * what would lose it. Every list here picks its items the way its part does
 * (`refs.ts` for tables, pages and roles; each part for the rest): an item
 * listed here and dropped by its part would be a promise the file breaks.
 *
 * Ids are the source's own (the wizard sends them back under `include`); they
 * never reach the file. Nothing here is written, and no value of a row is read:
 * row counts are the last schema read's estimates.
 */
import type { TableModel } from '@adminium/engine';
import {
  automationsRepo,
  documentProfilesRepo,
  emailTemplatesRepo,
  invoiceDocumentsRepo,
  payableProfilesRepo,
  publicEndpointsRepo,
  reportDocumentsRepo,
  scheduledReportsRepo,
  usersRepo,
  workspacesRepo,
} from '@adminium/meta';

import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { isUntouched } from '../../pages/generated-stamp.js';
import { parseDefinition } from '../../public-api/endpoint.js';
import { BUILTIN_EMAIL_TEMPLATE_KEYS } from '../../email/builtins.js';
import { buildSaveRefs, tableIdFor } from './refs.js';
import { SECRET_NAME } from './rows.js';
import { madeByInstalls, shownHere } from './saved-parts.js';
import type { SaveSource } from './types.js';

/** A link from one table's column to another table. */
export interface InventoryLink {
  column: string;
  /** The model id of the table it points at. */
  to: string;
  /** Every row must hold a value in it. */
  required: boolean;
}

export interface InventoryTable {
  id: string;
  name: string;
  columns: number;
  /** The last schema read's count; null when the database gave none. */
  rows: number | null;
  rowsExact: boolean;
  links: InventoryLink[];
  /** Columns marked personal: their values stay behind unless ticked. */
  personal: string[];
  /** Columns whose name or marks say secret: their values stay behind unless ticked. */
  secretLike: string[];
  /** The saver may save this table's rows (reads and exports it, all of it). */
  rowsAllowed: boolean;
  /** The saver may carry personal columns' values (`read_pii`). */
  personalAllowed: boolean;
}

export interface InventoryPage {
  id: string;
  title: string;
  tableId: string | null;
  /** As the generator made it: it travels in the short form. */
  generated: boolean;
}

export interface InventoryView {
  id: string;
  name: string;
  pageId: string;
  /** Null for a shared view. */
  ownerId: string | null;
  ownerName: string | null;
}

export interface InventoryItem {
  id: string;
  name: string;
  /** The tables it names (model ids). */
  tableIds: string[];
  /** The page it reports on, for a scheduled report. */
  pageId?: string;
}

export interface SaveInventory {
  connectionId: string;
  tables: InventoryTable[];
  pages: InventoryPage[];
  views: InventoryView[];
  roles: { id: string; name: string }[];
  automations: InventoryItem[];
  /** Campaigns: a template a rule sends travels with its rule. */
  emailTemplates: { key: string; name: string }[];
  documents: InventoryItem[];
  reports: InventoryItem[];
  invoiceLayouts: InventoryItem[];
  scheduledReports: InventoryItem[];
  publicEndpoints: InventoryItem[];
  /** A payments setup is here to carry. */
  payments: boolean;
  /** The saver may include the deployment-wide part (look, languages, wording, system emails). */
  instance: boolean;
}

export interface InventoryRights {
  userId: string | null;
  can(grant: string): Promise<boolean>;
  readsWhole(connectionId: string, tableId: string): Promise<boolean>;
}

/** Every string under a `table` (or `listed`) key of a stored rule, read as a table of the model. */
function tablesNamedIn(value: unknown, resolve: (name: string) => string | null, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) tablesNamedIn(entry, resolve, out);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const [key, inner] of Object.entries(value)) {
    if ((key === 'table' || key === 'listed') && typeof inner === 'string') {
      const id = resolve(inner);
      if (id !== null) out.add(id);
    } else {
      tablesNamedIn(inner, resolve, out);
    }
  }
  return out;
}

function tableOfEnvelope(config: unknown): string | null {
  if (config === null || typeof config !== 'object') return null;
  const source = (config as Record<string, unknown>)['source'];
  if (source === null || typeof source !== 'object') return null;
  const table = (source as Record<string, unknown>)['table'];
  return typeof table === 'string' ? table : null;
}

function linksOf(table: TableModel): InventoryLink[] {
  return table.columns.flatMap((column) =>
    column.references === null || column.references === undefined ? [] : [{ column: column.name, to: column.references.tableId, required: column.nullable === false }],
  );
}

export async function saveInventory(source: SaveSource, rights: InventoryRights): Promise<SaveInventory> {
  const { meta, connectionId, model } = source;
  // The quick save's choices: the refs list exactly what it would carry.
  const refs = await buildSaveRefs(source, { key: 'inventory', name: 'inventory', version: '1.0.0', label: 'inventory', lineage: 'inventory', savedAt: new Date(0).toISOString() });
  const resolve = (name: string): string | null => tableIdFor(model, name);
  const view = await loadSnapshotView(meta, connectionId);

  const tables: InventoryTable[] = [];
  for (const saved of refs.tables()) {
    const table = saved.model;
    const live = view.linkTable(table.id);
    const personal: string[] = [];
    const secretLike: string[] = [];
    for (const column of table.columns) {
      const resolved = live?.columns.get(column.name);
      if (resolved?.secret === true || column.semantics?.flags.secret === true || SECRET_NAME.test(column.name)) secretLike.push(column.name);
      else if (resolved?.masked === true) personal.push(column.name);
    }
    const base = `table:${connectionId}:${table.id}`;
    const rowsAllowed = (await rights.can(`${base}:read`)) && (await rights.can(`${base}:export`)) && (await rights.readsWhole(connectionId, table.id));
    tables.push({
      id: table.id,
      name: table.name,
      columns: table.columns.length,
      rows: table.rowCountEstimate,
      rowsExact: table.rowCountExact,
      links: linksOf(table),
      personal,
      secretLike,
      rowsAllowed,
      personalAllowed: await rights.can(`${base}:read_pii`),
    });
  }

  const pages: InventoryPage[] = refs.pages().map(({ page }) => {
    const table = tableOfEnvelope(page.config);
    return { id: page.id, title: page.title, tableId: table === null ? null : resolve(table), generated: isUntouched(page.config) };
  });

  // Views: the pages' shared ones, and every person's own (Check asks about those one by one).
  const pageIds = pages.map((page) => page.id);
  const viewRows =
    pageIds.length === 0
      ? []
      : await meta.db.selectFrom('adminium_views').select(['id', 'pageId', 'userId', 'kind', 'name']).where('pageId', 'in', pageIds).orderBy('createdAt').orderBy('id').execute();
  const names = new Map<string, string | null>();
  const nameOf = async (userId: string): Promise<string | null> => {
    if (!names.has(userId)) names.set(userId, (await usersRepo(meta).findById(userId))?.name ?? null);
    return names.get(userId) ?? null;
  };
  const views: InventoryView[] = [];
  for (const row of viewRows) {
    // A person's own arrangement of a dashboard is never a view of the app.
    if (row.kind === 'layout') continue;
    views.push({ id: row.id, name: row.name, pageId: row.pageId, ownerId: row.userId, ownerName: row.userId === null ? null : await nameOf(row.userId) });
  }

  const roles = refs.roles().map(({ role }) => ({ id: role.id, name: role.name }));

  const madeByDocuments = new Set((await documentProfilesRepo(meta).list({ connectionId })).flatMap((profile) => (profile.trigger?.automationId ? [profile.trigger.automationId] : [])));
  const automations: InventoryItem[] = (await automationsRepo(meta).list({ connectionId }))
    .filter((rule) => rule.managedBy === null && !madeByDocuments.has(rule.id))
    .reverse()
    .map((rule) => ({ id: rule.id, name: rule.name, tableIds: [...tablesNamedIn(rule, resolve)] }));

  const builtins: ReadonlySet<string> = new Set(BUILTIN_EMAIL_TEMPLATE_KEYS);
  const campaigns = new Map<string, string>();
  for (const row of await emailTemplatesRepo(meta).list()) {
    if (row.kind !== 'campaign' || row.managedBy !== null || builtins.has(row.key) || campaigns.has(row.key)) continue;
    campaigns.set(row.key, row.name);
  }
  const emailTemplates = [...campaigns].map(([key, name]) => ({ key, name }));

  const documents: InventoryItem[] = (await documentProfilesRepo(meta).list({ connectionId }))
    .filter((profile) => profile.ownerApp === null && profile.enabled)
    .map((profile) => {
      const id = resolve(profile.table);
      return { id: profile.id, name: profile.name, tableIds: id === null ? [] : [id] };
    });

  const made = await madeByInstalls(meta);
  const here = new Set(await workspacesRepo(meta).forConnection(connectionId));
  const reports: InventoryItem[] = [];
  for (const row of await reportDocumentsRepo(meta).list()) {
    if (made.has(`report:${row.id}`) || !(await shownHere(meta, 'report', row.id, here))) continue;
    reports.push({ id: row.id, name: row.name, tableIds: [...tablesNamedIn(row.body, resolve)] });
  }
  const invoiceLayouts: InventoryItem[] = [];
  for (const row of await invoiceDocumentsRepo(meta).list({ kind: 'template' })) {
    if (made.has(`invoice-layout:${row.id}`) || !(await shownHere(meta, 'invoice', row.id, here))) continue;
    invoiceLayouts.push({ id: row.id, name: row.name, tableIds: [...tablesNamedIn(row.body, resolve)] });
  }
  const pageSet = new Set(pageIds);
  const scheduledReports: InventoryItem[] = (await scheduledReportsRepo(meta).list())
    .filter((row) => !made.has(`scheduled-report:${row.id}`) && pageSet.has(row.pageId))
    .map((row) => ({ id: row.id, name: row.name, tableIds: [], pageId: row.pageId }));

  const publicEndpoints: InventoryItem[] = (await publicEndpointsRepo(meta).listByConnection(connectionId))
    .filter((endpoint) => endpoint.managedBy === null)
    .map((endpoint) => {
      const parsed = parseDefinition(endpoint.definition);
      const table = parsed.ok ? resolve(String((parsed.definition as { source?: unknown }).source ?? '')) : null;
      return { id: endpoint.id, name: endpoint.ref, tableIds: table === null ? [] : [table] };
    });

  const payments = (await payableProfilesRepo(meta).list(connectionId)).some((profile) => profile.ownerApp === null);

  return {
    connectionId,
    tables,
    pages,
    views,
    roles,
    automations,
    emailTemplates,
    documents,
    reports,
    invoiceLayouts,
    scheduledReports,
    publicEndpoints,
    payments,
    instance: await rights.can('system:settings:manage'),
  };
}
