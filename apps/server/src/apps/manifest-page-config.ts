// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The parts of a manifest page's `config` an app writes by hand: its form
 * and, for its Overview, its dashboard layout. Both name the app's tables by
 * their SHORT names, since the app cannot know the prefix or the schema an
 * install gives them; these bind them to the real ones.
 *
 *  - A form's column fields name columns, which keep their names. A relation
 *    field names the table at its other end — `modifier_groups`, or
 *    `modifier_groups.item_id` where two relations reach the same table — and
 *    becomes the relation's real id. A chips field may name its link table
 *    instead (`clinician_visit_types`): the table the app declared, which is
 *    also a child table of the form's own, so the field's control says which
 *    of the two relations it means.
 *  - A layout's widget queries name a table as `source: {name}` with no
 *    connection; they get the install's connection and the real table.
 *  - A calendar's columns (`calendar: {start, end?, title?, category?}`) name
 *    columns, which keep their names; they are handed to the composition as
 *    they are (`calendarOf`).
 *
 * The plan checks the same form against the manifest's own declarations
 * (`formIssues`), so an app whose form names a column it never declared is
 * refused before anything is written — never a form silently dropped.
 */
import { pageSourceTable, type CalendarColumns, type DatabaseModel } from '@adminium/engine';
import { z } from 'zod';
import { capacityCountsSchema, countsJoinSchema, filterNodeSchema, pageLayoutSchema, parseCrudDefaultFilters, parseCrudForm, type CrudFormConfig, type PageLayout } from '@adminium/engine/config';
import { pageBulkSchema, pageFiltersSchema, pageTabsSchema, type Manifest } from '@adminium/manifest';

import { childRelations } from '../crud/child-rows.js';
import { filterProblem, type DayColumnKind } from '../widget-data/filter-checks.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { linkableRelations } from '../crud/links.js';

type ManifestPage = NonNullable<Extract<Manifest, { kind: 'app' }>['pages']>[number];

/** `modifier_groups` or `modifier_groups.item_id`. */
function splitRelation(short: string): { ref: string; column: string | null } {
  const at = short.indexOf('.');
  return at === -1 ? { ref: short, column: null } : { ref: short.slice(0, at), column: short.slice(at + 1) };
}

/**
 * What is wrong with a page's form against the manifest's own tables, or an
 * empty list. Pure: the plan runs it before any table exists.
 */
export function formIssues(manifest: Manifest, page: ManifestPage): string[] {
  return [...ownFormIssues(manifest, page), ...defaultFilterIssues(manifest, page)];
}

/** A records page's default filters: a readable list, over columns of its own table. */
function defaultFilterIssues(manifest: Manifest, page: ManifestPage): string[] {
  const raw = page.config?.['defaultFilters'];
  // An add-on's page filters its own table as an app's does.
  if (raw === undefined || (manifest.requiredSchema?.tables ?? []).length === 0) return [];
  const parsed = parseCrudDefaultFilters({ defaultFilters: raw });
  if (parsed === null) return ['its default filters are not valid filters (1–6, each a column, an op and a value)'];
  const own = pageSourceTable(page);
  const table = own === null ? undefined : (manifest.requiredSchema?.tables ?? []).find((t) => t.ref === own);
  if (table === undefined) return ['it has default filters but no table of the app to filter'];
  return parsed.filter((filter) => !table.columns.some((c) => c.ref === filter.column)).map((filter) => `"${table.ref}" has no column "${filter.column}"`);
}

function ownFormIssues(manifest: Manifest, page: ManifestPage): string[] {
  const raw = page.config?.['form'];
  if (raw === undefined || manifest.kind !== 'app') return [];
  const form = parseCrudForm({ form: raw });
  if (form === null) return ['its form is not a valid form (v2, one to twelve sections, no column twice)'];
  const declared = new Map((manifest.requiredSchema?.tables ?? []).map((t) => [t.ref, t]));
  const own = pageSourceTable(page);
  const table = own === null ? undefined : declared.get(own);
  if (table === undefined) return ['it has a form but no table of the app to write to'];
  const columns = new Set(table.columns.map((c) => c.ref));
  const out: string[] = [];
  for (const section of form.sections) {
    if (section.aside !== undefined && !columns.has(section.aside)) out.push(`"${table.ref}" has no column "${section.aside}"`);
    for (const field of section.fields) {
      if ('column' in field && !columns.has(field.column)) out.push(`"${table.ref}" has no column "${field.column}"`);
      if ('relation' in field) {
        const { ref, column } = splitRelation(field.relation);
        const other = declared.get(ref);
        if (other === undefined) {
          out.push(`"${ref}" is not a table of the app`);
          continue;
        }
        if (column !== null && !other.columns.some((c) => c.ref === column) && !columns.has(column)) {
          out.push(`neither "${ref}" nor "${table.ref}" has a column "${column}"`);
        }
        for (const child of field.columns ?? []) {
          if (!other.columns.some((c) => c.ref === child.column)) out.push(`"${ref}" has no column "${child.column}"`);
        }
      }
    }
  }
  return out;
}

/**
 * The form with each relation field's short name replaced by the real
 * relation's id, or why it could not be.
 */
export function bindForm(
  raw: unknown,
  view: SnapshotView,
  table: ResolvedTable,
  names: Readonly<Record<string, string>>,
): { form: CrudFormConfig } | { problem: string } {
  const form = parseCrudForm({ form: raw });
  if (form === null) return { problem: 'its form is not a valid form' };
  // A link is named by the table it picks from — or, by a field that says it
  // picks, by its link table.
  const links = linkableRelations(view, table).map((link) => ({
    id: link.relationId,
    kind: 'link' as const,
    table: link.target.name,
    through: link.linkTable.name as string | null,
    column: link.ownColumn,
  }));
  const children = childRelations(view, table).map((child) => ({
    id: child.relationId,
    kind: 'child' as const,
    table: child.child.name,
    through: null,
    column: child.foreignColumn,
  }));
  const candidates = [...links, ...children];
  const bound = structuredClone(form);
  for (const section of bound.sections) {
    for (const field of section.fields) {
      if (!('relation' in field)) continue;
      const { ref, column } = splitRelation(field.relation);
      const real = names[ref] ?? ref;
      // Rows edited in place are a child relation; picked keys, a link.
      const kind = field.control === undefined ? null : field.control === 'child-rows' ? 'child' : 'link';
      const found = candidates.filter(
        (c) =>
          (c.table === real || (kind === 'link' && c.through === real)) &&
          (kind === null || c.kind === kind) &&
          (column === null || c.column === column),
      );
      if (found.length !== 1) {
        return {
          problem:
            found.length === 0
              ? kind === 'link'
                ? `nothing links "${table.name}" to "${real}" for a field that picks rows (a link table holds two keys and nothing else to fill)`
                : `nothing links "${table.name}" to "${real}"`
              : `"${table.name}" reaches "${real}" more than one way; name the column (${ref}.<column>)`,
        };
      }
      field.relation = found[0]!.id;
    }
  }
  return { form: bound };
}

/**
 * The columns a page's `config.calendar` names, or null when it names none.
 * The manifest's own check has judged it against the app's tables; this only
 * reads it.
 */
export function calendarOf(page: ManifestPage): CalendarColumns | null {
  const raw = page.config?.['calendar'];
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const text = (key: string): string | undefined => (typeof value[key] === 'string' && value[key] !== '' ? (value[key] as string) : undefined);
  const start = text('start');
  if (start === undefined) return null;
  const [end, title, category] = [text('end'), text('title'), text('category')];
  return {
    start,
    ...(end === undefined ? {} : { end }),
    ...(title === undefined ? {} : { title }),
    ...(category === undefined ? {} : { category }),
  };
}

/**
 * The layout with every widget query bound to the install's connection and
 * the real table, or why it could not be.
 */
export function bindLayout(
  raw: unknown,
  connectionId: string,
  model: DatabaseModel,
  names: Readonly<Record<string, string>>,
): { layout: PageLayout } | { problem: string } {
  const parsed = pageLayoutSchema.safeParse(raw);
  if (!parsed.success) return { problem: 'its layout is not a valid dashboard layout' };
  const layout = structuredClone(parsed.data);
  let problem: string | null = null;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const node = value as Record<string, unknown>;
    const source = node['source'];
    // A widget query: a source table and the shape it asks for.
    if (node['shape'] !== undefined && typeof source === 'object' && source !== null && typeof (source as { name?: unknown }).name === 'string') {
      const short = (source as { name: string }).name;
      const real = names[short] ?? short;
      const table = model.tables.find((t) => t.name === real);
      if (table === undefined) {
        problem ??= `"${short}" is not a table of this connection`;
      } else {
        node['connectionId'] = connectionId;
        // A schema only where a query names one: Postgres.
        const schema = model.dialect === 'postgres' && table.schema !== null ? { schema: table.schema } : {};
        node['source'] = { ...(source as object), name: table.name, ...schema };
      }
      // A list's counts name the limited table too (`counts: {table}`): bound the same way.
      const counts = node['counts'];
      if (typeof counts === 'object' && counts !== null && typeof (counts as { table?: unknown }).table === 'string') {
        const named = (counts as { table: string }).table;
        const limited = model.tables.find((t) => t.name === (names[named] ?? named));
        if (limited === undefined) problem ??= `"${named}" is not a table of this connection`;
        else node['counts'] = { ...(counts as object), table: model.dialect === 'postgres' && limited.schema !== null ? `${limited.schema}.${limited.name}` : limited.name };
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(layout.items);
  return problem === null ? { layout } : { problem };
}

/** Every table a layout's widget queries name, as written. */
export function layoutTables(layout: PageLayout): string[] {
  const out = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object' || value === null) return;
    const node = value as Record<string, unknown>;
    const source = node['source'] as { name?: unknown } | undefined;
    if (node['shape'] !== undefined && typeof source?.name === 'string') {
      out.add(source.name);
      const counts = node['counts'] as { table?: unknown } | undefined;
      if (typeof counts?.table === 'string') out.add(counts.table);
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(layout.items);
  return [...out];
}

/**
 * What a layout's widget queries carry that the dashboard could not read: a
 * filter group (`or` / `and`) or a filter on a venue `day` that is not one, a
 * list's `counts` that are not, a KPI figure (`capacity.metric`) that is not
 * one. Judged when the install is planned, so an app whose Overview asks for
 * one is refused before anything is written — never a card that fails on
 * every read. Only these parts are judged here: the rest of a query is read
 * as it always was.
 */
export function layoutQueryProblems(layout: PageLayout, manifest?: Manifest): string[] {
  const out: string[] = [];
  // What each declared column keeps, for a filter's `day` (a column one link away is judged when read).
  const kindOf = (table: string) => (name: string): DayColumnKind => {
    const declared = manifest?.kind === 'app' ? manifest.requiredSchema?.tables.find((t) => t.ref === table) : undefined;
    const column = declared?.columns.find((c) => c.ref === name);
    if (column === undefined) return 'unknown';
    return column.type === 'date' ? 'date' : column.type === 'timestamptz' ? 'time' : 'other';
  };
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object' || value === null) return;
    const node = value as Record<string, unknown>;
    const source = node['source'] as { name?: unknown } | undefined;
    if (node['shape'] !== undefined && typeof source?.name === 'string') {
      const where = `the card over "${source.name}"`;
      const filters = node['filters'];
      const grouped = Array.isArray(filters) && filters.some((filter) => typeof filter === 'object' && filter !== null && ('or' in filter || 'and' in filter || 'day' in filter));
      if (grouped) {
        // The rules every read of the card judges: the shape, then the count, the depth and each day.
        const problem = z.array(filterNodeSchema).max(16).safeParse(filters).success ? filterProblem(filters as unknown[], kindOf(source.name)) : { message: 'they are not ones a card can read' };
        if (problem !== null) out.push(`${where} has filters no card can read: ${problem.message.replace(/\.$/, '')}`);
      }
      if (node['counts'] !== undefined) {
        if (!countsJoinSchema.safeParse(node['counts']).success) out.push(`${where} asks for counts that are not ones a card can read`);
        else if (node['shape'] !== 'record-list') out.push(`${where} asks for counts beside something other than a list`);
      }
      const capacity = node['capacity'] as { metric?: unknown } | undefined;
      if (capacity?.metric !== undefined && !capacityCountsSchema.shape.metric.safeParse(capacity.metric).success) out.push(`${where} asks for a figure that is not one`);
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(layout.items);
  return out;
}

/** Words as a stored page keeps them: one string for the page's own language, and the others by locale (`de_DE`). */
function wordsPair(words: string | Readonly<Record<string, string>>): { text: string; texts?: Record<string, string> } {
  if (typeof words === 'string') return { text: words };
  const texts = Object.fromEntries(Object.entries(words).map(([tag, text]) => [tag.replace('-', '_'), text]));
  return { text: texts['en_US'] ?? Object.values(texts)[0] ?? '', texts };
}

export interface BoundListConfig {
  /** The keys to lay over the page's stored config. `detail` is the generated one with its tabs worded. */
  config: Record<string, unknown>;
  warnings: { reason: 'PAGE_FILTERS_INVALID' | 'PAGE_DEFAULT_FILTERS_INVALID' | 'PAGE_TABS_INVALID' | 'PAGE_TAB_UNKNOWN' | 'PAGE_BULK_INVALID'; message: string }[];
}

/**
 * WHAT A RECORDS PAGE SAYS OF ITSELF BESIDE ITS FORM, bound to the real
 * tables: the list's filters and the filters it opens with, the words of its
 * related tabs, its bulk actions. The manifest names tables by their short
 * names; the stored page names them as the snapshot does. Columns keep their
 * names.
 *
 * The manifest's own validation has refused a column that is not there, a
 * control a column cannot take, a secret in a confirm. What is checked again
 * here is what only the real database can say — that the table and its
 * generated tab exist — and a key that does not fit is a warning with its
 * page still written, never a page lost.
 */
export function bindListConfig(raw: Readonly<Record<string, unknown>> | undefined, view: SnapshotView, table: ResolvedTable, names: Readonly<Record<string, string>>, stored: Readonly<Record<string, unknown>>): BoundListConfig {
  const out: BoundListConfig = { config: {}, warnings: [] };
  if (raw === undefined) return out;
  const realTable = (ref: string): ResolvedTable | null => {
    const name = names[ref] ?? ref;
    const model = view.model.tables.find((candidate) => candidate.name === name || candidate.id === name);
    if (model === undefined) return null;
    try {
      return view.table(model.id);
    } catch {
      return null;
    }
  };
  const missing = (columns: readonly string[], of: ResolvedTable = table): string | undefined => columns.find((column) => !of.columns.has(column));

  if (raw['filters'] !== undefined) {
    const parsed = pageFiltersSchema.safeParse(raw['filters']);
    const gone = parsed.success ? missing(parsed.data.map((filter) => filter.column)) : undefined;
    if (!parsed.success) out.warnings.push({ reason: 'PAGE_FILTERS_INVALID', message: 'its filters are not valid filters, so it has the filters Adminium picks' });
    else if (gone !== undefined) out.warnings.push({ reason: 'PAGE_FILTERS_INVALID', message: `"${table.name}" has no column "${gone}", so it has the filters Adminium picks` });
    else {
      // A filter's label is one string: the page's own language.
      out.config['filters'] = parsed.data.map((filter) => ({ column: filter.column, ...(filter.control === undefined ? {} : { control: filter.control }), ...(filter.label === undefined ? {} : { label: wordsPair(filter.label).text }) }));
    }
  }

  if (raw['defaultFilters'] !== undefined) {
    const parsed = parseCrudDefaultFilters({ defaultFilters: raw['defaultFilters'] });
    const gone = parsed === null ? undefined : missing(parsed.map((filter) => filter.column));
    if (parsed === null) out.warnings.push({ reason: 'PAGE_DEFAULT_FILTERS_INVALID', message: 'its default filters are not valid filters, so the list opens unfiltered' });
    else if (gone !== undefined) out.warnings.push({ reason: 'PAGE_DEFAULT_FILTERS_INVALID', message: `"${table.name}" has no column "${gone}", so the list opens unfiltered` });
    else out.config['defaultFilters'] = parsed;
  }

  if (raw['tabs'] !== undefined) {
    const parsed = pageTabsSchema.safeParse(raw['tabs']);
    const detail = stored['detail'] as { tabs?: { table: string }[] } | undefined;
    if (!parsed.success) out.warnings.push({ reason: 'PAGE_TABS_INVALID', message: 'its tab words are not valid, so its tabs say what every tab says' });
    else {
      const tabs = (detail?.tabs ?? []).map((tab) => ({ ...tab }));
      for (const [ref, words] of Object.entries(parsed.data)) {
        const child = realTable(ref);
        // Every tab over that child table: two links from one table cannot be told apart here, and both get the words.
        const worded = child === null ? [] : tabs.filter((tab) => tab.table === child.id);
        if (worded.length === 0) {
          out.warnings.push({ reason: 'PAGE_TAB_UNKNOWN', message: `the page has no tab for "${ref}", so its words for one were left out` });
          continue;
        }
        const title = words.empty === undefined ? undefined : wordsPair(words.empty);
        const body = words.emptyBody === undefined ? undefined : wordsPair(words.emptyBody);
        for (const tab of worded) {
          Object.assign(tab, {
            ...(title === undefined ? {} : { empty: { title: title.text, ...(title.texts === undefined ? {} : { titles: title.texts }), ...(body === undefined ? {} : { body: body.text, ...(body.texts === undefined ? {} : { bodies: body.texts }) }) } }),
            ...(words.noNew === true ? { noNew: true } : {}),
          });
        }
      }
      if (detail !== undefined) out.config['detail'] = { ...detail, tabs };
    }
  }

  if (raw['bulk'] !== undefined) {
    const parsed = pageBulkSchema.safeParse(raw['bulk']);
    if (!parsed.success) out.warnings.push({ reason: 'PAGE_BULK_INVALID', message: 'its bulk actions are not valid, so the list offers none of them' });
    else {
      const bound: Record<string, unknown>[] = [];
      for (const action of parsed.data) {
        const child = realTable(action.child.table);
        const gone = child === null ? action.child.table : (missing([action.child.via, ...action.child.form, ...Object.keys(action.set ?? {})], child) ?? missing([...(action.where === undefined ? [] : [action.where.column]), ...action.confirm.columns]));
        if (child === null || gone !== undefined) {
          out.warnings.push({ reason: 'PAGE_BULK_INVALID', message: `"${action.id}" names "${String(gone)}", which is not here, so the list does not offer it` });
          continue;
        }
        const [label, title, body, done] = [wordsPair(action.label), wordsPair(action.confirm.title), wordsPair(action.confirm.body), wordsPair(action.done)];
        bound.push({
          id: action.id,
          label: label.text,
          ...(label.texts === undefined ? {} : { labels: label.texts }),
          child: { table: child.id, via: action.child.via, form: [...action.child.form] },
          ...(action.set === undefined ? {} : { set: { ...action.set } }),
          ...(action.where === undefined ? {} : { where: { ...action.where } }),
          confirm: { title: title.text, ...(title.texts === undefined ? {} : { titles: title.texts }), body: body.text, ...(body.texts === undefined ? {} : { bodies: body.texts }), columns: [...action.confirm.columns] },
          done: done.text,
          ...(done.texts === undefined ? {} : { dones: done.texts }),
        });
      }
      if (bound.length > 0) out.config['bulk'] = bound;
    }
  }
  return out;
}
