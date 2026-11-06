// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SOURCE IDS → THE NAMES THEY HAVE IN THE FILE.
 *
 * A file never holds an id from the install it was made on: a table is
 * named by its ref, a page by its ref, a role by its key, an email template by
 * its name (the install makes `<appkey>-<name>`), an option list by its name.
 * This map is built ONCE, before any part runs, so every part writes the same
 * name for the same thing, and a part that meets an id with no name here
 * (something left out) says so in Check instead of writing the id.
 *
 * What is in by default (the quick save), each narrowed by `SaveChoices`:
 *  - tables: every table of the model that is not a system table, not
 *    Adminium's own (`adminium_…`) and not held by an install (an add-on's or
 *    a catalog app's table: `heldBy` names the install, and the add-ons part
 *    turns it into `addOns` or `apps.requires`). A released table (its
 *    install gone) is the database's own again and is in;
 *  - pages: the connection's pages no install made and that are not system pages;
 *  - roles: roles no app made, not built in, holding a grant on this
 *    connection (a table here, or a page of this connection);
 *  - email templates and option lists: every one no install manages. They
 *    reach the file only when a part USES one (`useTemplate`, `useOptionList`),
 *    or the person chose a campaign; `usedTemplates()` / `usedOptionLists()`
 *    are what the email and tables parts write.
 */
import { slugify } from '@adminium/engine';
import type { DatabaseModel, TableModel } from '@adminium/engine';
import { appTablesRepo, emailTemplatesRepo, optionListsRepo, pagesRepo, permissionsRepo, rolesRepo, type AppTableRecord, type Page, type Role } from '@adminium/meta';

import type { SaveChoices, SaveSource } from './types.js';

/** Postgres's limit on a page address the manifest accepts (`manifest-pages.ts` `PAGE_SLUG`). */
const PAGE_REF_MAX = 31;
/** `<appkey>-<name>` is at most 80 characters (`outbox.ts`). */
const TEMPLATE_KEY_MAX = 80;

export interface SavedTable {
  /** The model's id (`public.orders`). */
  id: string;
  ref: string;
  model: TableModel;
  /** The file must carry `name` (the real name differs from the ref). */
  needsName: boolean;
  /** The file must carry `schema` (Postgres, not the default schema). */
  needsSchema: boolean;
}

export interface HeldTable {
  id: string;
  record: AppTableRecord;
}

export interface SaveRefs {
  /** The tables that travel, in model order. */
  tables(): readonly SavedTable[];
  /** Model table id → ref, or null when the table does not travel. */
  table(id: string): string | null;
  /** A real name (`orders`, `sales.orders`) or a model id → ref, or null. A bare name means the default schema. */
  tableByName(real: string): string | null;
  /** A table an install holds on this database (an add-on's, a catalog app's), by model id. */
  heldBy(id: string): HeldTable | null;

  pages(): readonly { page: Page; ref: string }[];
  page(id: string): string | null;

  roles(): readonly { role: Role; key: string }[];
  role(id: string): string | null;

  /** An email template key → its name in the file, marking it used; null when no such template may travel. */
  useTemplate(key: string): string | null;
  usedTemplates(): readonly { key: string; name: string }[];
  /** The `<appkey>-<name>` the install will give a template name. */
  installedTemplateKey(name: string): string;

  /** An option list key → its name in the file, marking it used; null for a built-in list (`builtin:…`) or one an app owns. */
  useOptionList(key: string): string | null;
  usedOptionLists(): readonly { key: string; name: string }[];
}

/** A unique name from a registry: `orders`, `orders_2`, `orders_3`, … */
function allocator(join: string, max: number) {
  const taken = new Set<string>();
  return (wanted: string): string => {
    const base = wanted.slice(0, max);
    let name = base;
    for (let n = 2; taken.has(name); n += 1) {
      const suffix = `${join}${String(n)}`;
      name = `${base.slice(0, max - suffix.length)}${suffix}`;
    }
    taken.add(name);
    return name;
  };
}

/** A table or column name as a snake_case ref. */
export function snakeRef(name: string): string {
  const snake = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '');
  return snake === '' ? 't' : snake;
}

function isOwnTable(table: TableModel): boolean {
  return table.system !== true && !table.name.startsWith('adminium_');
}

export async function buildSaveRefs(source: SaveSource, choices: SaveChoices): Promise<SaveRefs> {
  const { meta, connectionId, model } = source;
  const records = await appTablesRepo(meta).forConnection(connectionId);
  const held = new Map<string, HeldTable>();
  for (const record of records) {
    if (record.manifestId === null || record.releasedAt !== null) continue;
    const id = tableIdFor(model, record.schemaName === null ? record.tableName : `${record.schemaName}.${record.tableName}`);
    if (id !== null) held.set(id, { id, record });
  }

  // Tables.
  const chosenTables = choices.tables === undefined ? null : new Set(choices.tables);
  const tableRef = allocator('_', 63);
  const tables: SavedTable[] = [];
  for (const table of model.tables) {
    if (!isOwnTable(table) || held.has(table.id)) continue;
    if (chosenTables !== null && !chosenTables.has(table.id)) continue;
    const ref = tableRef(snakeRef(table.name));
    tables.push({ id: table.id, ref, model: table, needsName: ref !== table.name, needsSchema: source.dialect === 'postgres' && table.schema !== model.defaultSchema });
  }
  const tableById = new Map(tables.map((t) => [t.id, t.ref]));

  // Pages.
  const chosenPages = choices.pages === undefined ? null : new Set(choices.pages);
  const pageRef = allocator('-', PAGE_REF_MAX);
  const pages = (await pagesRepo(meta).listForConnection(connectionId))
    .filter((page) => page.manifestId === null && page.origin !== 'system' && (chosenPages === null || chosenPages.has(page.id)))
    .map((page) => ({ page, ref: pageRef(slugify(page.slug).slice(0, PAGE_REF_MAX).replace(/-+$/, '') || 'page') }));
  const pageById = new Map(pages.map((p) => [p.page.id, p.ref]));

  // Roles: not built in, no app's, holding a grant here.
  const chosenRoles = choices.roles === undefined ? null : new Set(choices.roles);
  const roleKey = allocator('-', 60);
  const roles: { role: Role; key: string }[] = [];
  const permissions = permissionsRepo(meta);
  const connectionPageIds = new Set((await pagesRepo(meta).listForConnection(connectionId)).map((page) => page.id));
  for (const role of await rolesRepo(meta).list()) {
    if (role.isBuiltin || role.appKey !== null) continue;
    if (chosenRoles !== null && !chosenRoles.has(role.id)) continue;
    const grants = await permissions.listForRole(role.id);
    const here = grants.some((grant) => (grant.resourceKind === 'table' && grant.resourceRef.startsWith(`${connectionId}/`)) || (grant.resourceKind === 'page' && connectionPageIds.has(grant.resourceRef)));
    if (!here) continue;
    roles.push({ role, key: roleKey(slugify(role.slug) || 'role') });
  }
  const roleById = new Map(roles.map((r) => [r.role.id, r.key]));

  // Templates and option lists: named lazily, on first use.
  const appKey = choices.key;
  const templateRows = await emailTemplatesRepo(meta).list();
  const travellingTemplates = new Set(templateRows.filter((t) => t.managedBy === null).map((t) => t.key));
  const templateName = allocator('-', TEMPLATE_KEY_MAX - appKey.length - 1);
  const templates = new Map<string, string>();
  const optionRows = await optionListsRepo(meta).list();
  const travellingLists = new Set(optionRows.filter((row) => !row.origin.startsWith('app:')).map((row) => row.key));
  const listName = allocator('-', 60);
  const lists = new Map<string, string>();

  return {
    tables: () => tables,
    table: (id) => tableById.get(id) ?? null,
    tableByName: (real) => {
      const id = tableIdFor(model, real);
      return id === null ? null : (tableById.get(id) ?? null);
    },
    heldBy: (id) => held.get(id) ?? null,
    pages: () => pages,
    page: (id) => pageById.get(id) ?? null,
    roles: () => roles,
    role: (id) => roleById.get(id) ?? null,
    useTemplate: (key) => {
      if (!travellingTemplates.has(key)) return null;
      let name = templates.get(key);
      if (name === undefined) {
        name = templateName(slugify(key) || 'mail');
        templates.set(key, name);
      }
      return name;
    },
    usedTemplates: () => [...templates].map(([key, name]) => ({ key, name })),
    installedTemplateKey: (name) => `${appKey}-${name}`,
    useOptionList: (key) => {
      if (key.startsWith('builtin:') || !travellingLists.has(key)) return null;
      let name = lists.get(key);
      if (name === undefined) {
        name = listName(slugify(key) || 'list');
        lists.set(key, name);
      }
      return name;
    },
    usedOptionLists: () => [...lists].map(([key, name]) => ({ key, name })),
  };
}

/**
 * A real name or a model id → the model's id: an exact id first, else a bare
 * name in the default schema. Never a same-named table of another schema.
 */
export function tableIdFor(model: Pick<DatabaseModel, 'tables' | 'defaultSchema'>, real: string): string | null {
  if (model.tables.some((table) => table.id === real)) return real;
  const dot = real.indexOf('.');
  if (dot > 0) {
    const schema = real.slice(0, dot);
    const name = real.slice(dot + 1);
    return model.tables.find((table) => table.schema === schema && table.name === name)?.id ?? null;
  }
  return model.tables.find((table) => table.schema === model.defaultSchema && table.name === real)?.id ?? null;
}
