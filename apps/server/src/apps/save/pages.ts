// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP, ONE PART: THE PAGES AND THEIR SHARED VIEWS.
 *
 * A page nobody edited since the generator made it travels in the short form
 * (`{ref, template, title, nav, bindings}`): the target composes it again from
 * its own tables. Any other page travels as an `envelope`, carrying only what
 * a person arranged on it. The install takes the rest from the target:
 *
 *  - a column keeps its name and what a person chose about it (label, labels,
 *    hidden, display, width). What it IS (its type, whether it may be empty,
 *    its meaning, its link) the target reads from its own table. A column
 *    worked out on the page (a lookup, a count of another table's rows, a
 *    page total) is not a column of the table, so it travels whole;
 *  - every table the page names is written as the app's table ref, at the
 *    places the install's walk reads (`envelope-refs.ts`), and a widget query
 *    loses its `connectionId` and its schema;
 *  - nothing that only means something on this install travels: no id, no
 *    connection, no storage destination. An entry that holds one is left out
 *    and said in the Check list.
 *
 * A link from one page to another (`href: "/p/<slug>"`) is rewritten to the
 * page's ref, since a long address is shortened in the file.
 *
 * Shared views travel as they are stored. A person's own view travels only
 * when they chose to make it a shared view of the app; a person's dashboard
 * arrangement never does.
 */
import { isTableBoundTemplate, type Relation } from '@adminium/engine';
import type { AppManifest, PageView } from '@adminium/manifest';
import { ID_PREFIXES, LAYOUT_OVERRIDE_NAME, overridesRepo, viewsRepo, type Page, type SavedView } from '@adminium/meta';

import { applyRelationOverrides } from '../../connections/effective-schema.js';
import { isUntouched } from '../../pages/generated-stamp.js';
import { findInstanceIds } from '../../project/instance-ids.js';
import { tableRefsOf } from '../envelope-refs.js';
import { CHOSEN_COLUMN_FIELDS } from '../manifest-envelopes.js';
import { tableIdFor } from './refs.js';
import type { ConvertContext, ConvertPart } from './types.js';

type Doc = Record<string, unknown>;
type ManifestPage = AppManifest['pages'][number];

/** The most shared views one page carries (`PAGE_VIEWS_MAX`). */
const VIEWS_MAX = 24;
const VIEW_NAME_MAX = 120;
const TITLE_MAX = 120;
const BCP47 = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Keys of a page body that say what the source's table is, not what a person chose. */
const DERIVED_BODY_KEYS = new Set(['generatedHash', 'readOnly']);

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
/** An id of this install anywhere inside a string: a meta row id or a generated page id. */
const INSTANCE_ID = new RegExp(`(?:^|[^A-Za-z0-9])(?:${Object.keys(ID_PREFIXES).join('|')})_${ULID}|page_[0-9a-f]{8}_[a-z0-9]`);
/** A link to a page of the dashboard. */
const PAGE_LINK = /^\/p\/([a-z0-9][a-z0-9-]*)((?:[/?#].*)?)$/;

function isDoc(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a string holds an id that only means something on this install. */
export function holdsInstanceId(value: string): boolean {
  return INSTANCE_ID.test(value);
}

/** What the part knows while it writes one page. */
interface PageScope {
  ctx: ConvertContext;
  page: Page;
  /** The page's name as the person knows it. */
  item: string;
  /** The app's table refs: the only tables a written page may name. */
  known: ReadonlySet<string>;
  /** Model ids of tables left out of Adminium here (`table.exclude`): the app carries them, no page may show them. */
  excluded: ReadonlySet<string>;
  relations: readonly Relation[];
  /** Source slug → the ref of a page that travels. */
  pageRefs: ReadonlyMap<string, string>;
  /** Source slugs of this database's pages that do not travel. */
  leftPages: ReadonlySet<string>;
}

function say(scope: PageScope, code: string, field: string, message: string, kind = 'page', item = scope.item): void {
  scope.ctx.check.add({ group: 'info', code, kind, item, field, message });
}

/** A stored table id, or a real name, → the app's ref; null when that table does not travel or no page may show it. */
function refOf(scope: PageScope, table: unknown, byName = false): string | null {
  if (typeof table !== 'string') return null;
  const id = byName ? tableIdFor(scope.ctx.source.model, table) : table;
  if (id === null || scope.excluded.has(id)) return null;
  return scope.ctx.refs.table(id);
}

/**
 * A widget's query with its tables as refs and without what only this
 * install knows (its connection, a schema). Null when it reads a table that
 * does not travel.
 */
function portableQuery(scope: PageScope, query: unknown): Doc | null {
  if (!isDoc(query)) return null;
  const { connectionId: _connection, ...out } = query;
  const source = query['source'];
  if (isDoc(source) && typeof source['name'] === 'string') {
    const { schema, ...rest } = source;
    const ref = refOf(scope, typeof schema === 'string' && schema !== '' ? `${schema}.${source['name']}` : source['name'], true);
    if (ref === null) return null;
    out['source'] = { ...rest, name: ref };
  }
  const counts = query['counts'];
  if (isDoc(counts) && typeof counts['table'] === 'string') {
    const ref = refOf(scope, counts['table'], true);
    if (ref === null) return null;
    out['counts'] = { ...counts, table: ref };
  }
  const team = query['team'];
  const goals = isDoc(team) ? team['target'] : undefined;
  if (isDoc(team) && isDoc(goals) && typeof goals['table'] === 'string') {
    const ref = refOf(scope, goals['table'], true);
    if (ref === null) return null;
    out['team'] = { ...team, target: { ...goals, table: ref } };
  }
  return out;
}

/** A dashboard's cards with their queries made portable; a card that reads a table left out is left out too. */
function portableLayout(scope: PageScope, layout: unknown, at: string): unknown {
  if (!isDoc(layout) || !Array.isArray(layout['items'])) return layout;
  const items: unknown[] = [];
  for (const item of layout['items']) {
    if (!isDoc(item) || !isDoc(item['config'])) {
      items.push(item);
      continue;
    }
    const config: Doc = { ...item['config'] };
    let readable = true;
    if (config['binding'] !== undefined) {
      const query = portableQuery(scope, config['binding']);
      if (query === null) readable = false;
      else config['binding'] = query;
    }
    if (Array.isArray(config['statBindings'])) {
      const queries = config['statBindings'].map((binding) => portableQuery(scope, binding));
      if (queries.some((query) => query === null)) readable = false;
      else config['statBindings'] = queries;
    }
    if (!readable) {
      say(scope, 'WIDGET_TABLE_LEFT_OUT', `${at}.${String(item['i'] ?? items.length)}`, 'A card reads a table that is not in the app, so the card was left out.');
      continue;
    }
    items.push({ ...item, config });
  }
  return { ...layout, items };
}

/** A list's column: its name and what a person chose; a column worked out on the page travels whole. */
function portableColumn(scope: PageScope, column: unknown): Doc | null {
  if (!isDoc(column) || typeof column['name'] !== 'string') return null;
  if (column['lookup'] !== undefined || column['reverse'] !== undefined || column['derived'] !== undefined) {
    const { fk, ...out } = column;
    if (isDoc(out['reverse'])) {
      const ref = refOf(scope, out['reverse']['table']);
      if (ref === null) {
        say(scope, 'COLUMN_TABLE_LEFT_OUT', `columns.${column['name']}`, 'A column counts rows of a table that is not in the app, so the column was left out.');
        return null;
      }
      out['reverse'] = { ...out['reverse'], table: ref };
    }
    if (isDoc(fk)) {
      const ref = refOf(scope, fk['table']);
      if (ref !== null) out['fk'] = { ...fk, table: ref };
    }
    return out;
  }
  const out: Doc = { name: column['name'] };
  for (const field of CHOSEN_COLUMN_FIELDS) if (column[field] !== undefined) out[field] = column[field];
  return out;
}

/** A form's relation field as `<table ref>.<column>`, the form the install binds; null when it cannot be named. */
function portableRelation(scope: PageScope, relationId: unknown): string | null {
  const own = (scope.page.config as { source?: { table?: unknown } }).source?.table;
  const relation = scope.relations.find((candidate) => candidate.id === relationId);
  if (relation === undefined || typeof own !== 'string') return null;
  if (relation.through === null) {
    // Rows of another table edited in place: the child table and its column pointing here.
    if (relation.to.tableId !== own) return null;
    const ref = refOf(scope, relation.from.tableId);
    return ref === null ? null : `${ref}.${relation.from.columns[0]!}`;
  }
  // Rows picked through a link table: the table at the other end, and the link table's column pointing here.
  const forward = relation.from.tableId === own;
  if (!forward && relation.to.tableId !== own) return null;
  const target = refOf(scope, forward ? relation.to.tableId : relation.from.tableId);
  const through = refOf(scope, relation.through.tableId);
  const column = forward ? relation.through.fromColumns[0] : relation.through.toColumns[0];
  return target === null || through === null || column === undefined ? null : `${target}.${column}`;
}

function portableForm(scope: PageScope, form: unknown): unknown {
  if (!isDoc(form) || !Array.isArray(form['sections'])) return form;
  const sections = form['sections'].map((section, s) => {
    if (!isDoc(section) || !Array.isArray(section['fields'])) return section;
    const fields: unknown[] = [];
    section['fields'].forEach((field, f) => {
      if (!isDoc(field) || field['relation'] === undefined) {
        fields.push(field);
        return;
      }
      const relation = portableRelation(scope, field['relation']);
      if (relation === null) {
        say(scope, 'FORM_FIELD_LEFT_OUT', `form.sections.${String(s)}.fields.${String(f)}`, 'A form field picks rows of a table that is not in the app, so the field was left out.');
        return;
      }
      fields.push({ ...field, relation });
    });
    return { ...section, fields };
  });
  return { ...form, sections };
}

/**
 * Links between pages: `/p/<slug>` becomes `/p/<ref>`. A link to a page that
 * does not travel stays as written and is said.
 */
function relinked(scope: PageScope, node: unknown, at: string): unknown {
  if (Array.isArray(node)) return node.map((item, index) => relinked(scope, item, `${at}.${String(index)}`));
  if (!isDoc(node)) return node;
  const out: Doc = {};
  for (const [key, value] of Object.entries(node)) {
    const where = at === '' ? key : `${at}.${key}`;
    const link = key === 'href' && typeof value === 'string' ? PAGE_LINK.exec(value) : null;
    if (link !== null) {
      const ref = scope.pageRefs.get(link[1]!);
      if (ref !== undefined) out[key] = `/p/${ref}${link[2]!}`;
      else {
        if (scope.leftPages.has(link[1]!)) say(scope, 'PAGE_LINK_LEFT_OUT', where, 'A link opens a page that is not in the app, so it will lead nowhere there.');
        out[key] = value;
      }
      continue;
    }
    out[key] = relinked(scope, value, where);
  }
  return out;
}

const DROP = Symbol('drop');

/**
 * The document without anything only this install knows. A `connectionId`
 * goes (the install gives the target's own), a storage destination goes (the
 * target's default is used), and an entry holding an id of this install is
 * left out: the nearest item of a list holding it, or else the key itself.
 */
function withoutInstanceValues(scope: PageScope, node: unknown, at: string, inList: boolean, kind: string, item: string): unknown {
  if (typeof node === 'string') {
    if (!holdsInstanceId(node)) return node;
    say(scope, 'INSTANCE_VALUE_LEFT_OUT', at, 'An entry names something that exists only on this Adminium (a person, a role, a record of its own), so it was left out.', kind, item);
    return DROP;
  }
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    node.forEach((entry, index) => {
      const kept = withoutInstanceValues(scope, entry, `${at}.${String(index)}`, true, kind, item);
      if (kept !== DROP) out.push(kept);
    });
    return out;
  }
  if (!isDoc(node)) return node;
  const out: Doc = {};
  for (const [key, value] of Object.entries(node)) {
    const where = at === '' ? key : `${at}.${key}`;
    if (key === 'connectionId') continue;
    if (key === 'destinationId') {
      say(scope, 'DESTINATION_LEFT_OUT', where, 'Files go to the default storage of the Adminium the app is installed on.', kind, item);
      continue;
    }
    const kept = withoutInstanceValues(scope, value, where, inList, kind, item);
    if (kept === DROP) {
      if (inList) return DROP;
      continue;
    }
    out[key] = kept;
  }
  return out;
}

/** The page's body as the file carries it. */
function portableBody(scope: PageScope, stored: Doc): Doc {
  const body: Doc = {};
  for (const [key, value] of Object.entries(stored)) if (!DERIVED_BODY_KEYS.has(key)) body[key] = value;

  if (Array.isArray(body['columns'])) {
    body['columns'] = body['columns'].map((column) => portableColumn(scope, column)).filter((column): column is Doc => column !== null);
  }
  const detail = body['detail'];
  if (isDoc(detail) && Array.isArray(detail['tabs'])) {
    const tabs: unknown[] = [];
    for (const tab of detail['tabs']) {
      if (!isDoc(tab)) continue;
      const ref = refOf(scope, tab['table']);
      if (ref === null) say(scope, 'TAB_TABLE_LEFT_OUT', 'detail.tabs', 'A related tab shows a table that is not in the app, so the tab was left out.');
      else tabs.push({ ...tab, table: ref });
    }
    body['detail'] = { ...detail, tabs };
  }
  const derived = body['derived'];
  if (isDoc(derived) && Array.isArray(derived['measures'])) {
    const measures: unknown[] = [];
    for (const measure of derived['measures']) {
      if (!isDoc(measure) || measure['table'] === undefined) {
        measures.push(measure);
        continue;
      }
      const ref = refOf(scope, measure['table']);
      if (ref === null) say(scope, 'MEASURE_TABLE_LEFT_OUT', 'derived.measures', 'A page total adds up a table that is not in the app, so the total was left out.');
      else measures.push({ ...measure, table: ref });
    }
    body['derived'] = { ...derived, measures };
  }
  const domain = body['domain'];
  if (isDoc(domain) && Array.isArray(domain['tables'])) {
    body['domain'] = { ...domain, tables: domain['tables'].map((table) => refOf(scope, table)).filter((ref): ref is string => ref !== null) };
  }
  if (body['layout'] !== undefined) body['layout'] = portableLayout(scope, body['layout'], 'layout.items');
  if (body['form'] !== undefined) body['form'] = portableForm(scope, body['form']);

  const linked = relinked(scope, body, '') as Doc;
  return withoutInstanceValues(scope, linked, '', false, 'page', scope.item) as Doc;
}

/** Every table a written document names must be one of the app's: a bug here is never written. */
function assertOwnTables(scope: PageScope, document: unknown, what: string): void {
  for (const { ref, where } of tableRefsOf(document)) {
    if (!scope.known.has(ref)) throw new Error(`save: ${what} of the page "${scope.item}" names "${ref}" at ${where}, which is not a table of the app`);
  }
  const ids = findInstanceIds(document);
  if (ids.length > 0) throw new Error(`save: ${what} of the page "${scope.item}" holds an id of this install at ${ids[0]!.path}`);
}

/** The page's shared views, and the personal views its owners chose to share. */
async function portableViews(scope: PageScope): Promise<PageView[]> {
  const { ctx, page } = scope;
  const rows = await ctx.source.meta.db.selectFrom('adminium_views').select('id').where('pageId', '=', page.id).orderBy('createdAt').orderBy('id').execute();
  const repo = viewsRepo(ctx.source.meta);
  const shared = new Set(ctx.choices.shareViews ?? []);
  const leaveOut = new Set(ctx.choices.leaveOut ?? []);
  const stored: SavedView[] = [];
  for (const row of rows) {
    const view = await repo.findById(row.id);
    if (view !== null) stored.push(view);
  }
  // Shared views first: they keep their names and their default.
  stored.sort((a, b) => Number(a.userId !== null) - Number(b.userId !== null));

  const out: PageView[] = [];
  const names = new Set<string>();
  const defaults = new Set<string>();
  for (const view of stored) {
    // A person's own arrangement of a dashboard is never a view of the app.
    if (view.kind === 'layout' && (view.userId !== null || view.name === LAYOUT_OVERRIDE_NAME)) continue;
    const personal = view.userId !== null;
    const item = `${scope.item}: ${view.name}`;
    if (personal && !shared.has(view.id)) {
      if (leaveOut.has(`view:${view.id}`)) continue;
      ctx.check.add({
        group: 'choice',
        code: 'PERSONAL_VIEW',
        kind: 'view',
        item,
        message: `"${view.name}" is somebody's own view of "${scope.item}". Make it a shared view of the app, or leave it out.`,
        answer: { choices: ['make-shared', 'leave-out'], target: view.id },
      });
      continue;
    }
    if (out.length === VIEWS_MAX) {
      say(scope, 'VIEWS_TOO_MANY', 'views', `A page carries ${String(VIEWS_MAX)} views at most, so "${view.name}" was left out.`, 'view', item);
      continue;
    }
    const config = isDoc(view.config) ? view.config : {};
    let body: Doc;
    let version = 1;
    if (view.kind === 'filters') {
      const { v, ...rest } = config;
      if (typeof v === 'number') version = v;
      body = rest;
    } else {
      body = portableLayout(scope, config, 'views.layout.items') as Doc;
    }
    body = withoutInstanceValues(scope, relinked(scope, body, ''), '', false, 'view', item) as Doc;
    if (view.kind === 'layout') assertOwnTables(scope, { config: { layout: body } }, `the view "${view.name}"`);
    else assertOwnTables(scope, body, `the view "${view.name}"`);

    // One name per kind, as the file wants it; a personal view may share a name with a shared one.
    const base = view.name.slice(0, VIEW_NAME_MAX);
    let name = base;
    for (let n = 2; names.has(`${view.kind}:${name}`); n += 1) {
      const suffix = ` (${String(n)})`;
      name = `${base.slice(0, VIEW_NAME_MAX - suffix.length)}${suffix}`;
    }
    names.add(`${view.kind}:${name}`);
    const isDefault = !personal && view.isDefault && !defaults.has(view.kind);
    if (isDefault) defaults.add(view.kind);
    out.push({ v: version, kind: view.kind, name, ...(isDefault ? { isDefault: true } : {}), config: body });
  }
  return out;
}

/** The page's title in other languages, as the file keys them. */
function titlesOf(envelope: Doc): Record<string, string> | undefined {
  const title = envelope['title'];
  const titles = isDoc(title) ? title['titles'] : undefined;
  if (!isDoc(titles)) return undefined;
  const out: Record<string, string> = {};
  for (const [tag, text] of Object.entries(titles)) {
    if (BCP47.test(tag) && typeof text === 'string' && text.trim() !== '') out[tag] = text.trim().slice(0, TITLE_MAX);
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** The tables the newest active `table.exclude` row leaves out of Adminium. */
function excludedTables(overrides: readonly { op: string; tableName: string; value: unknown; createdAt: number }[]): Set<string> {
  const latest = new Map<string, boolean>();
  for (const row of [...overrides].filter((o) => o.op === 'table.exclude').sort((a, b) => a.createdAt - b.createdAt)) {
    latest.set(row.tableName, isDoc(row.value) && row.value['excluded'] === true);
  }
  return new Set([...latest].filter(([, out]) => out).map(([id]) => id));
}

export const convertPages: ConvertPart = async (ctx) => {
  const { refs, check, choices, source } = ctx;
  const leaveOut = new Set(choices.leaveOut ?? []);
  const overrides = await overridesRepo(source.meta).listForConnection(source.connectionId, { status: 'active' });
  const relations = applyRelationOverrides(source.model.relations, overrides);
  const excluded = excludedTables(overrides);
  const known = new Set(refs.tables().filter((table) => !excluded.has(table.id)).map((table) => table.ref));

  // Which pages travel: a page bound to a table that does not travel is the person's choice.
  const going: { page: Page; ref: string; envelope: Doc; tableRef: string | null }[] = [];
  const leftPages = new Set<string>();
  for (const { page, ref } of refs.pages()) {
    const envelope = isDoc(page.config) ? page.config : null;
    if (envelope === null || !isDoc(envelope['config'])) {
      check.add({ group: 'info', code: 'PAGE_UNREADABLE', kind: 'page', item: page.title, message: 'The page has no document Adminium can read, so it was left out.' });
      leftPages.add(page.slug);
      continue;
    }
    const table = isDoc(envelope['source']) ? envelope['source']['table'] : null;
    const tableRef = typeof table === 'string' && !excluded.has(table) ? refs.table(table) : null;
    if (typeof table === 'string' && tableRef === null) {
      leftPages.add(page.slug);
      if (!leaveOut.has(`page:${page.id}`)) {
        check.add({
          group: 'choice',
          code: 'PAGE_TABLE_LEFT_OUT',
          kind: 'page',
          item: page.title,
          message: excluded.has(table)
            ? `"${page.title}" shows a table that is left out of Adminium here. Leave the page out, or bring the table back.`
            : `"${page.title}" shows a table that is not in the app. Leave the page out, or put its table in the app.`,
          answer: { choices: ['leave-out'], target: `page:${page.id}` },
        });
      }
      continue;
    }
    going.push({ page, ref, envelope, tableRef });
  }
  const pageRefs = new Map(going.map(({ page, ref }) => [page.slug, ref]));

  const pages: ManifestPage[] = [];
  for (const { page, ref, envelope, tableRef } of going) {
    const scope: PageScope = { ctx, page, item: page.title, known, excluded, relations, pageRefs, leftPages };
    const template = typeof envelope['template'] === 'string' ? envelope['template'] : page.type;
    const nav = isDoc(envelope['nav']) ? envelope['nav'] : {};
    const group = page.navGroup ?? (typeof nav['group'] === 'string' ? nav['group'] : 'library');
    const offRail = page.navGroup === null || nav['hidden'] === true;
    const titles = titlesOf(envelope);
    const written: ManifestPage = {
      ref,
      template,
      title: { key: `nav.${ref}`, fallback: page.title.trim().slice(0, TITLE_MAX) || ref },
      ...(titles === undefined ? {} : { titles }),
      nav: {
        group,
        icon: page.icon ?? (typeof nav['icon'] === 'string' ? nav['icon'] : 'file'),
        order: Math.trunc(page.navOrder),
        ...(offRail ? { offRail: true as const } : {}),
      },
      ...(tableRef !== null && isTableBoundTemplate(template) ? { bindings: { rows: tableRef } } : {}),
    };
    if (!page.isEnabled) check.add({ group: 'info', code: 'PAGE_DISABLED', kind: 'page', item: page.title, message: 'The page is switched off here; it is switched on where the app is installed.' });

    // The short form only where the target composes the same page: an untouched page of one table.
    const short = isUntouched(envelope) && written.bindings !== undefined;
    if (!short) {
      const config = portableBody(scope, envelope['config'] as Doc);
      assertOwnTables(scope, { config }, 'the envelope');
      written.envelope = {
        v: typeof envelope['v'] === 'number' ? envelope['v'] : 1,
        kind: typeof envelope['kind'] === 'string' ? envelope['kind'] : 'page',
        template,
        config,
        ...(envelope['padding'] === undefined ? {} : { padding: envelope['padding'] }),
        ...(typeof envelope['width'] === 'string' ? { width: envelope['width'] } : {}),
      };
    }
    const views = await portableViews(scope);
    if (views.length > 0) written.views = views;
    pages.push(written);
  }
  return pages.length === 0 ? {} : { pages };
};
