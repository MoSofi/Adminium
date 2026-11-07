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
 *
 * It shows the saver what they may see and nothing more: a table they do not
 * read is left out (and its name with it, wherever an item names it), a
 * column their read does not show is left out of every list, a row estimate
 * is given only for a table they read whole, and the views are the ones they
 * may use (their own and the shared ones), never whose a view is.
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
  workspacesRepo,
} from '@adminium/meta';

import { readViewOf } from '../../crud/read-view.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { isUntouched } from '../../pages/generated-stamp.js';
import { parseDefinition } from '../../public-api/endpoint.js';
import { BUILTIN_EMAIL_TEMPLATE_KEYS } from '../../email/builtins.js';
import { buildSaveRefs, tableIdFor } from './refs.js';
import type { ReadLimits } from '../../rbac/read-limits.js';
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
  /** The columns the saver's read shows. */
  columns: number;
  /** The last schema read's count; null when the database gave none, or the saver reads only part of the table. */
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
  /** Null for a shared view; the saver's own id for one of theirs (nobody else's is listed). */
  ownerId: string | null;
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
  /** The saver's resolved permissions, for the columns their read does not show. */
  permissions(): Promise<{ superAdmin?: boolean; readLimits?: ReadLimits | undefined }>;
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

/** The table a page's stored envelope shows (`source.table`), or null. */
export function tableOfEnvelope(config: unknown): string | null {
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
  // The source as the saver reads it: a column their read does not show, or a code no staff member reads, is unreadable.
  const readView = readViewOf(view, await rights.permissions());

  const tables: InventoryTable[] = [];
  // The tables the saver reads: an item naming any other leaves that name out.
  const seen = new Set<string>();
  for (const saved of refs.tables()) {
    const table = saved.model;
    const base = `table:${connectionId}:${table.id}`;
    if (!(await rights.can(`${base}:read`))) continue;
    seen.add(table.id);
  }
  const shown = (ids: Iterable<string>): string[] => [...ids].filter((id) => seen.has(id));
  for (const saved of refs.tables()) {
    const table = saved.model;
    if (!seen.has(table.id)) continue;
    const live = view.linkTable(table.id);
    const read = readView.linkTable(table.id);
    const readable = table.columns.filter((column) => read?.columns.get(column.name)?.unreadable !== true);
    const readableNames = new Set(readable.map((column) => column.name));
    const personal: string[] = [];
    const secretLike: string[] = [];
    for (const column of readable) {
      const resolved = live?.columns.get(column.name);
      if (resolved?.secret === true || column.semantics?.flags.secret === true || SECRET_NAME.test(column.name)) secretLike.push(column.name);
      else if (resolved?.masked === true) personal.push(column.name);
    }
    const base = `table:${connectionId}:${table.id}`;
    const whole = await rights.readsWhole(connectionId, table.id);
    const rowsAllowed = whole && (await rights.can(`${base}:export`));
    tables.push({
      id: table.id,
      name: table.name,
      columns: readable.length,
      rows: whole ? table.rowCountEstimate : null,
      rowsExact: whole && table.rowCountExact,
      links: linksOf(table).filter((link) => readableNames.has(link.column) && seen.has(link.to)),
      personal,
      secretLike,
      rowsAllowed,
      personalAllowed: await rights.can(`${base}:read_pii`),
    });
  }

  // A page of a table the saver does not read is left out with its table.
  const pages: InventoryPage[] = refs.pages().flatMap(({ page }) => {
    const table = tableOfEnvelope(page.config);
    const tableId = table === null ? null : resolve(table);
    if (tableId !== null && !seen.has(tableId)) return [];
    return [{ id: page.id, title: page.title, tableId, generated: isUntouched(page.config) }];
  });

  /*
   * Views: the ones the saver may use on the pages listed, their own and the
   * shared ones. Another person's view is never listed, nor whose a view is.
   */
  const pageIds = pages.map((page) => page.id);
  const viewRows =
    pageIds.length === 0
      ? []
      : await meta.db.selectFrom('adminium_views').select(['id', 'pageId', 'userId', 'kind', 'name']).where('pageId', 'in', pageIds).orderBy('createdAt').orderBy('id').execute();
  const views: InventoryView[] = [];
  for (const row of viewRows) {
    // A person's own arrangement of a dashboard is never a view of the app.
    if (row.kind === 'layout') continue;
    if (row.userId !== null && row.userId !== rights.userId) continue;
    views.push({ id: row.id, name: row.name, pageId: row.pageId, ownerId: row.userId });
  }

  const roles = refs.roles().map(({ role }) => ({ id: role.id, name: role.name }));

  const madeByDocuments = new Set((await documentProfilesRepo(meta).list({ connectionId })).flatMap((profile) => (profile.trigger?.automationId ? [profile.trigger.automationId] : [])));
  const automations: InventoryItem[] = (await automationsRepo(meta).list({ connectionId }))
    .filter((rule) => rule.managedBy === null && !madeByDocuments.has(rule.id))
    .reverse()
    .map((rule) => ({ id: rule.id, name: rule.name, tableIds: shown(tablesNamedIn(rule, resolve)) }));

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
      return { id: profile.id, name: profile.name, tableIds: id === null ? [] : shown([id]) };
    });

  const made = await madeByInstalls(meta);
  const here = new Set(await workspacesRepo(meta).forConnection(connectionId));
  const reports: InventoryItem[] = [];
  for (const row of await reportDocumentsRepo(meta).list()) {
    if (made.has(`report:${row.id}`) || !(await shownHere(meta, 'report', row.id, here))) continue;
    reports.push({ id: row.id, name: row.name, tableIds: shown(tablesNamedIn(row.body, resolve)) });
  }
  const invoiceLayouts: InventoryItem[] = [];
  for (const row of await invoiceDocumentsRepo(meta).list({ kind: 'template' })) {
    if (made.has(`invoice-layout:${row.id}`) || !(await shownHere(meta, 'invoice', row.id, here))) continue;
    invoiceLayouts.push({ id: row.id, name: row.name, tableIds: shown(tablesNamedIn(row.body, resolve)) });
  }
  const pageSet = new Set(pageIds);
  const scheduledReports: InventoryItem[] = (await scheduledReportsRepo(meta).list())
    .filter((row) => !made.has(`scheduled-report:${row.id}`) && pageSet.has(row.pageId))
    .map((row) => ({ id: row.id, name: row.name, tableIds: [], pageId: row.pageId }));

  // An endpoint of a table the saver does not read is left out with its table: its address is often the table's name.
  const publicEndpoints: InventoryItem[] = (await publicEndpointsRepo(meta).listByConnection(connectionId))
    .filter((endpoint) => endpoint.managedBy === null)
    .flatMap((endpoint) => {
      const parsed = parseDefinition(endpoint.definition);
      const table = parsed.ok ? resolve(String((parsed.definition as { source?: unknown }).source ?? '')) : null;
      if (table !== null && !seen.has(table)) return [];
      return [{ id: endpoint.id, name: endpoint.ref, tableIds: table === null ? [] : [table] }];
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
