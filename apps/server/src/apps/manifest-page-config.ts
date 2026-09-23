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
 *    becomes the relation's real id.
 *  - A layout's widget queries name a table as `source: {name}` with no
 *    connection; they get the install's connection and the real table.
 *
 * The plan checks the same form against the manifest's own declarations
 * (`formIssues`), so an app whose form names a column it never declared is
 * refused before anything is written — never a form silently dropped.
 */
import { pageSourceTable, type DatabaseModel } from '@adminium/engine';
import { pageLayoutSchema, parseCrudForm, type CrudFormConfig, type PageLayout } from '@adminium/engine/config';
import type { Manifest } from '@adminium/manifest';

import { childRelations } from '../crud/child-rows.js';
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
  const links = linkableRelations(view, table).map((link) => ({ id: link.relationId, table: link.target.name, column: link.ownColumn }));
  const children = childRelations(view, table).map((child) => ({
    id: child.relationId,
    table: child.child.name,
    column: child.foreignColumn,
  }));
  const candidates = [...links, ...children];
  const bound = structuredClone(form);
  for (const section of bound.sections) {
    for (const field of section.fields) {
      if (!('relation' in field)) continue;
      const { ref, column } = splitRelation(field.relation);
      const real = names[ref] ?? ref;
      const found = candidates.filter((c) => c.table === real && (column === null || c.column === column));
      if (found.length !== 1) {
        return {
          problem:
            found.length === 0
              ? `nothing links "${table.name}" to "${real}"`
              : `"${table.name}" reaches "${real}" more than one way; name the column (${ref}.<column>)`,
        };
      }
      field.relation = found[0]!.id;
    }
  }
  return { form: bound };
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
    if (node['shape'] !== undefined && typeof source?.name === 'string') out.add(source.name);
    for (const child of Object.values(node)) visit(child);
  };
  visit(layout.items);
  return [...out];
}
