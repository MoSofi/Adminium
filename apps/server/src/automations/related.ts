// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RELATED ROW, ONE HOP: `<link column>.<column>`.
 *
 * Wherever a rule names a column of its record it may name a column of the
 * row one of the record's foreign keys points at: the order's customer's
 * email is `customer_id.email`. One dot, one hop, and only over a link the
 * schema snapshot holds from the rule's own table.
 *
 * Three readers share this file so they cannot disagree:
 *
 *  - the VALIDATOR (does the link exist, does the far column exist, may the
 *    author read it),
 *  - the GRANTS (reading a related table is reading a table),
 *  - the RUNNER (load each related row a rule names once per run, by key).
 *
 * What it will not do: a second hop, a composite key, a join table. Each is a
 * name the validator refuses, so no rule is stored that the runner would have
 * to guess at.
 */
import type { AutomationGraph, AutomationNode } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';

/** A column of a related row, as a rule spells it. */
export interface RelatedRef {
  /** The record's own column that holds the link. */
  link: string;
  /** The column of the row it points at. */
  column: string;
}

/** `customer_id.email` → its two halves; `null` for a plain column name or anything with more than one dot. */
export function parseRelated(name: string): RelatedRef | null {
  const at = name.indexOf('.');
  if (at <= 0 || at === name.length - 1 || name.indexOf('.', at + 1) !== -1) return null;
  return { link: name.slice(0, at), column: name.slice(at + 1) };
}

/** Where a link leads: the table it points at and the column of that table it holds. */
export interface RelatedTarget {
  table: ResolvedTable;
  /** The far table's column the link's value is matched against (its key, or a unique column). */
  key: string;
}

/**
 * The table a link column of `table` points at, in this view. `null` when the
 * column is no link the snapshot holds, is one half of a composite key, or
 * points at a table this view does not have (excluded, or Adminium's own).
 */
export function relatedTarget(view: SnapshotView, table: ResolvedTable, link: string): RelatedTarget | null {
  const relation = view.model.relations.find(
    (candidate) =>
      candidate.through === null &&
      candidate.from.tableId === table.id &&
      candidate.from.columns.length === 1 &&
      candidate.from.columns[0] === link &&
      candidate.to.columns.length === 1,
  );
  if (relation === undefined) return null;
  try {
    return { table: view.table(relation.to.tableId), key: relation.to.columns[0] as string };
  } catch {
    return null;
  }
}

/** Every link column of a table that leads somewhere, with where. For a list a person or a model picks from. */
export function relatedTargets(view: SnapshotView, table: ResolvedTable): { link: string; target: RelatedTarget }[] {
  const out: { link: string; target: RelatedTarget }[] = [];
  for (const name of table.columns.keys()) {
    const target = relatedTarget(view, table, name);
    if (target !== null) out.push({ link: name, target });
  }
  return out;
}

/**
 * Whether a column holds an email address, by the engine's own reading of the
 * schema (its semantic mark, set from the column's type and name at
 * introspection, or by a person in the schema editor).
 */
export function isAddressColumn(table: ResolvedTable, name: string): boolean {
  const semantics = table.table.columns.find((column) => column.name === name)?.semantics;
  return semantics?.primary === 'email' || semantics?.flags.pii === 'email';
}

const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/** Every `{{…}}` name in every text a value holds, however deep. */
function tokenNames(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(TOKEN)) into.add(match[1] as string);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) tokenNames(entry, into);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) tokenNames(entry, into);
  }
}

function nodesOf(graph: AutomationGraph): AutomationNode[] {
  const out: AutomationNode[] = [];
  for (const node of graph.nodes) {
    out.push(node);
    if (node.kind === 'branch') for (const branch of node.branches) out.push(...(branch.nodes as AutomationNode[]));
  }
  return out;
}

/** A related name a step uses, and which step: for a refusal that says where. */
export interface RelatedUse extends RelatedRef {
  nodeId: string;
  title: string;
  /** An email step's recipient, or a `{{token}}` in a text. */
  as: 'recipient' | 'token';
  /** The kind of step it is in: a mail's values may read what other steps may not. */
  step: string;
}

/**
 * Every `<name>.<name>` a rule's steps spell, as a recipient or inside a
 * `{{token}}` (`{{record.customer_id.email}}` and `{{customer_id.email}}` are
 * the same one). Whether the first half IS a link is the caller's to ask of
 * the schema: a token nobody recognises is left as written, as it always was.
 */
export function relatedUses(graph: AutomationGraph): RelatedUse[] {
  const out: RelatedUse[] = [];
  for (const node of nodesOf(graph)) {
    if (node.kind !== 'action') continue;
    const action = node.action;
    if (action.kind === 'email' && action.to?.kind === 'field') {
      const ref = parseRelated(action.to.column);
      if (ref !== null) out.push({ ...ref, nodeId: node.id, title: node.title, as: 'recipient', step: action.kind });
    }
    const names = new Set<string>();
    tokenNames(action, names);
    for (const name of names) {
      const ref = parseRelated(name.startsWith('record.') ? name.slice('record.'.length) : name);
      if (ref !== null) out.push({ ...ref, nodeId: node.id, title: node.title, as: 'token', step: action.kind });
    }
  }
  return out;
}

/** One related row of a run: where it came from, and the row (null when the link is empty or the row is gone). */
export interface RelatedRow {
  table: ResolvedTable;
  row: Row | null;
}

/**
 * Load the related rows a rule names, once each, by key. A link the snapshot
 * no longer holds is left OUT of the answer: the step that names it then
 * fails by name, which is the only honest thing to say of it.
 */
export async function loadRelated(
  source: { db: Kysely<SourceDatabase>; view: SnapshotView; table: ResolvedTable; row: Row },
  links: Iterable<string>,
): Promise<Map<string, RelatedRow>> {
  const out = new Map<string, RelatedRow>();
  for (const link of new Set(links)) {
    const target = relatedTarget(source.view, source.table, link);
    if (target === null) continue;
    const value = source.row[link];
    if (value === null || value === undefined || value === '') {
      out.set(link, { table: target.table, row: null });
      continue;
    }
    const row = await fetchByPk(source.db, target.table, { [target.key]: value } as Row).catch(() => undefined);
    out.set(link, { table: target.table, row: row ?? null });
  }
  return out;
}

/** A far column a token may read: there, and neither masked nor secret. */
export function isTokenColumn(column: ResolvedColumn | undefined): column is ResolvedColumn {
  return column !== undefined && !column.masked && !column.secret && column.unreadable !== true;
}
