// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WALK OVER A PAGE'S TABLES MISSES NONE.
 *
 * A page saved into a file names its tables by the app's refs, and the
 * install turns each into the target's table through one closed list of
 * places (`apps/envelope-refs.ts`). A place a template or a stored page
 * schema holds a table that is NOT on the list would carry the source's table
 * into the target — or a table nobody declared. Two reads fail on one:
 *
 *  - every page every template composes, over two databases (Northwind, and
 *    one made to trigger every template), and every page `generatePages`
 *    makes: any value naming a table is on the list, or on the short list of
 *    places that only mention one (reviewed below);
 *  - every stored-page schema the engine exports: a key that holds a table
 *    (`table`, `tables`, `…Table`) sits where the list reaches.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TABLE_BOUND_TEMPLATES, composeRequestedPage, generatePages, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import * as pageConfig from '@adminium/engine/config';
import { describe, expect, it } from 'vitest';

import { ENVELOPE_TABLE_PATHS, QUERY_TABLE_PATHS, expandedTablePaths } from '../src/apps/envelope-refs.js';

/** Places that mention a table and are not a reference to one: text, an address, an id of the page itself. */
const MENTIONS: Readonly<Record<string, string>> = {
  'config.archetype.reasons[]': 'why the classifier chose the template, in words',
  'nav.slug': 'the page address, made by the install',
  'id': 'the page id, made by the install',
  'title.key': 'a translation key',
  'config.domain.key': "a dashboard domain's name, a slug",
  'config.layout.items[].i': "a card's id on its grid",
  'config.columns[].name': "a column of the page's own table, which may share a table's name (Northwind's region)",
};

const northwind = parseDatabaseModel(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/engine/test/fixtures/northwind.model.json', import.meta.url)), 'utf8')) as unknown,
);

interface Col {
  name: string;
  logicalType: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  enumRef?: string;
  references?: { tableId: string; column: string };
  maxLength?: number;
}

function table(name: string, columns: Col[], rows = 5_000): Record<string, unknown> {
  return {
    id: `public.${name}`,
    schema: 'public',
    name,
    kind: 'table',
    rowCountEstimate: rows,
    primaryKey: columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name),
    columns: columns.map((column, index) => ({
      name: column.name,
      ordinal: index + 1,
      dbType: column.logicalType,
      logicalType: column.logicalType,
      nullable: column.nullable ?? true,
      isPrimaryKey: column.isPrimaryKey ?? false,
      isUnique: column.isUnique ?? column.isPrimaryKey ?? false,
      enumRef: column.enumRef ?? null,
      references: column.references ?? null,
      ...(column.maxLength === undefined ? {} : { maxLength: column.maxLength }),
    })),
  };
}

const pk: Col = { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true };
const at: Col = { name: 'created_at', logicalType: 'timestamptz', nullable: false };
const fk = (name: string, to: string, nullable = true): Col => ({ name, logicalType: 'integer', nullable, references: { tableId: `public.${to}`, column: 'id' } });
const text = (name: string, nullable = false): Col => ({ name, logicalType: 'varchar', maxLength: 200, nullable });

/** One table per template's trigger, each linked so detail tabs, link columns and dashboards appear. */
const everyTemplate: DatabaseModel = parseDatabaseModel({
  irVersion: 1,
  dialect: 'postgres',
  source: { kind: 'live', connectionId: 'conn_01HZXGUARD0000000000000000' },
  name: 'guard',
  defaultSchema: 'public',
  schemas: ['public'],
  enums: [
    { id: 'public.task_status', name: 'task_status', values: ['todo', 'doing', 'review', 'done'] },
    { id: 'public.shift_kind', name: 'shift_kind', values: ['morning', 'evening'] },
    { id: 'public.approval', name: 'approval', values: ['pending', 'approved', 'rejected'] },
    { id: 'public.priority', name: 'priority', values: ['low', 'high'] },
  ],
  tables: [
    table('zq_people', [pk, text('full_name'), { name: 'email', logicalType: 'varchar', maxLength: 200, nullable: false, isUnique: true }, { name: 'avatar_url', logicalType: 'text' }, fk('manager_id', 'zq_people')]),
    table('zq_tasks', [pk, text('title'), { name: 'status', logicalType: 'enum', enumRef: 'public.task_status', nullable: false }, fk('owner_id', 'zq_people'), { name: 'amount', logicalType: 'decimal' }, at]),
    table('zq_task_notes', [pk, fk('task_id', 'zq_tasks', false), { name: 'body', logicalType: 'text', nullable: false }, at]),
    table('zq_releases', [pk, text('title'), { name: 'released_at', logicalType: 'timestamptz', nullable: false }, fk('task_id', 'zq_tasks')]),
    table('zq_shifts', [pk, fk('person_id', 'zq_people', false), { name: 'shift_date', logicalType: 'date', nullable: false }, { name: 'kind', logicalType: 'enum', enumRef: 'public.shift_kind', nullable: false }]),
    table('zq_audit', [pk, { name: 'action', logicalType: 'varchar', maxLength: 40, nullable: false }, fk('actor_id', 'zq_people'), at]),
    table('zq_files', [pk, { name: 'file_name', logicalType: 'varchar', maxLength: 255, nullable: false }, { name: 'file_size', logicalType: 'bigint', nullable: false }, { name: 'mime_type', logicalType: 'varchar', maxLength: 80 }, fk('parent_id', 'zq_files')]),
    table('zq_threads', [pk, text('subject'), at]),
    table('zq_messages', [pk, fk('thread_id', 'zq_threads', false), fk('sender_id', 'zq_people', false), { name: 'body', logicalType: 'text', nullable: false }, at]),
    table('zq_approvals', [pk, text('subject'), { name: 'state', logicalType: 'enum', enumRef: 'public.approval', nullable: false }, at]),
    table('zq_tickets', [pk, text('subject'), { name: 'description', logicalType: 'text' }, { name: 'priority', logicalType: 'enum', enumRef: 'public.priority', nullable: false }, fk('task_id', 'zq_tasks'), at]),
  ],
});

/** `config.columns[3].fk.table` → `config.columns[].fk.table`. */
function normalised(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

/** Every place in `document` whose value names a table of `model`, with the value. */
function tablesNamed(document: unknown, model: DatabaseModel): Map<string, string> {
  const ids = model.tables.map((t) => t.id);
  const names = new Set(model.tables.map((t) => t.name));
  const out = new Map<string, string>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (names.has(node) || ids.some((id) => node.includes(id))) out.set(normalised(path), node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${String(i)}]`));
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (ids.some((id) => key.includes(id)) || names.has(key)) out.set(normalised(`${path}.{key}`), key);
        walk(value, path === '' ? key : `${path}.${key}`);
      }
    }
  };
  walk(document, '');
  return out;
}

/** Every page a template composes over `model`, and every page generation makes. */
function composedPages(model: DatabaseModel): { pages: Record<string, unknown>[]; templates: Set<string> } {
  const pages: Record<string, unknown>[] = [];
  const templates = new Set<string>();
  for (const t of model.tables) {
    for (const template of TABLE_BOUND_TEMPLATES) {
      const built = composeRequestedPage(model, t.id, template, { connectionId: 'conn_x', slug: 'guard', id: 'page_guard', navGroup: 'library', navIcon: 'table', navOrder: 1 });
      if (built.envelope === null) continue;
      pages.push(built.envelope);
      templates.add(template);
    }
  }
  for (const page of generatePages(model, { connectionId: 'conn_x' }).pages) {
    pages.push(page as unknown as Record<string, unknown>);
    templates.add(String((page as { template?: unknown }).template));
  }
  return { pages, templates };
}

describe('the walk over the places a page names a table', () => {
  const listed = new Set(expandedTablePaths());

  it('reaches every table a composed or generated page names', () => {
    const found = new Map<string, string>();
    const templates = new Set<string>();
    for (const model of [northwind, everyTemplate]) {
      const composed = composedPages(model);
      for (const template of composed.templates) templates.add(template);
      for (const page of composed.pages) for (const [path, value] of tablesNamed(page, model)) found.set(path, value);
    }
    // Not vacuous: every table-bound template and a dashboard were composed, and the list's own places were met.
    for (const template of [...TABLE_BOUND_TEMPLATES, 'page-dashboard']) expect(templates, `nothing composed ${template}`).toContain(template);
    for (const path of ['source.table', 'access.permissions[]', 'config.columns[].fk.table', 'config.detail.tabs[].table', 'config.domain.tables[]', 'config.layout.items[].config.binding.source.name', 'config.layout.items[].config.statBindings[].source.name']) {
      expect([...found.keys()], `no page named a table at ${path}`).toContain(path);
    }
    const unlisted = [...found].filter(([path]) => !listed.has(path) && MENTIONS[path] === undefined);
    expect(unlisted.map(([path, value]) => `${path} = ${value}`), 'a page names a table where the walk does not look').toEqual([]);
  });

  it('reaches every key of a stored page schema that holds a table', () => {
    const queries = ENVELOPE_TABLE_PATHS.filter((entry) => entry.form === 'query').map((entry) => entry.path);
    // Where each schema sits in a stored page.
    const mounts: Readonly<Record<string, readonly string[]>> = {
      pageEnvelopeSchema: [''],
      gridColumnSpecSchema: ['config.columns[]'],
      crudDetailConfigSchema: ['config.detail'],
      crudDetailTabSchema: ['config.detail.tabs[]'],
      crudDerivedConfigSchema: ['config.derived'],
      measureSchema: ['config.derived.measures[]'],
      queryDescriptorSchema: queries,
      countsJoinSchema: queries.map((query) => `${query}.counts`),
      pageLayoutSchema: ['config.layout'],
      layoutItemSchema: ['config.layout.items[]'],
      widgetConfigSchema: ['config.layout.items[]'],
      crudFormConfigSchema: ['config.form'],
      crudFiltersConfigSchema: ['config'],
      crudLabelsConfigSchema: ['config'],
      crudAttachmentsConfigSchema: ['config.attachments'],
    };
    // `table`, `tables`, `tableId`, `targetTable`: never `sortable`.
    const holdsTable = /^tables?(?:Id)?$|[a-z]Tables?(?:Id)?$/;
    const keys: { schema: string; path: string }[] = [];
    const walk = (schema: unknown, path: string, name: string, depth: number): void => {
      const def = (schema as { _zod?: { def?: Record<string, unknown> } } | null)?._zod?.def;
      if (def === undefined || depth > 24) return;
      switch (def['type']) {
        case 'object':
          for (const [key, child] of Object.entries(def['shape'] as Record<string, unknown>)) {
            const at = path === '' ? key : `${path}.${key}`;
            if (holdsTable.test(key)) keys.push({ schema: name, path: at });
            walk(child, at, name, depth + 1);
          }
          return;
        case 'array':
          walk(def['element'], `${path}[]`, name, depth + 1);
          return;
        case 'record':
          walk(def['valueType'], `${path}.{key}`, name, depth + 1);
          return;
        case 'union':
          for (const option of def['options'] as unknown[]) walk(option, path, name, depth + 1);
          return;
        case 'intersection':
          walk(def['left'], path, name, depth + 1);
          walk(def['right'], path, name, depth + 1);
          return;
        case 'pipe':
          walk(def['in'], path, name, depth + 1);
          walk(def['out'], path, name, depth + 1);
          return;
        case 'lazy':
          walk((def['getter'] as () => unknown)(), path, name, depth + 6);
          return;
        case 'optional':
        case 'nullable':
        case 'default':
        case 'prefault':
        case 'catch':
        case 'readonly':
        case 'nonoptional':
          walk(def['innerType'], path, name, depth + 1);
          return;
        default:
          return;
      }
    };
    for (const [name, schema] of Object.entries(pageConfig)) {
      if (name.endsWith('Schema')) walk(schema, '', name, 0);
    }
    // Not vacuous: the schemas the list was read from are among them.
    expect(keys.map((key) => `${key.schema}:${key.path}`)).toEqual(expect.arrayContaining(['gridColumnSpecSchema:fk.table', 'crudDetailTabSchema:table', 'queryDescriptorSchema:counts.table']));
    const missed: string[] = [];
    for (const key of keys) {
      const where = mounts[key.schema];
      if (where === undefined) {
        missed.push(`${key.schema}.${key.path}: say where ${key.schema} sits in a stored page`);
        continue;
      }
      for (const mount of where) {
        const path = mount === '' ? key.path : `${mount}.${key.path}`;
        if (!listed.has(path)) missed.push(`${key.schema}.${key.path} (${path})`);
      }
    }
    expect(missed, 'a stored page schema holds a table where the walk does not look').toEqual([]);
  });

  it('spells out a query\'s own places beside each place a query sits', () => {
    expect(QUERY_TABLE_PATHS).toEqual(['source.name', 'counts.table', 'team.target.table']);
    expect(listed).toContain('config.layout.items[].config.statBindings[].team.target.table');
  });
});
