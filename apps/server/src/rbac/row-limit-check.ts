// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A ROW LIMIT CAN HOLD ON A TABLE, asked before one is stored and
 * before a figure is worked out under one.
 *
 * A limit that names a table that is not there, one that does not say whose
 * its rows are, or a private one (read by its own people whatever a role
 * says) would be stored and never judged: the screen would say "their own
 * rows" and the role would read every row. And "only while column X is one
 * of …" may name only a column staff read plainly: under a hidden one, the
 * count of rows reached tells its values to whoever edits roles.
 */
import { BELONGS_VIA_MAX_STEPS } from '@adminium/manifest';
import { notThroughOf, rowReachList, type RowLimit, type RowReach } from '@adminium/meta';

import type { EffectiveModel } from '../connections/effective-schema.js';

export interface RowLimitIssue {
  code:
    | 'no-such-table'
    | 'private'
    | 'no-belongs'
    | 'no-such-column'
    | 'hidden-column'
    | 'not-a-staff-column'
    | 'not-by-read'
    | 'not-a-parent'
    | 'via-without-by'
    | 'not-through-read'
    | 'not-a-listing';
  message: string;
  column?: string;
  /** The listing a `notThrough` names that the table is not read through. */
  listing?: string;
}

/**
 * The listings a table's rows are read through: the table of each of its
 * `through` ways, and of the rows it hangs off (`via`), as far up as the row
 * test follows a link. What a reach's `notThrough` may name.
 */
export function listingsOfTable(model: Pick<EffectiveModel, 'tables' | 'relations'>, tableId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string, steps: number, seen: ReadonlySet<string>): void => {
    const table = model.tables.find((candidate) => candidate.id === id);
    for (const way of table?.belongs ?? []) {
      if ('through' in way) out.add(way.through.table);
      else if ('via' in way && steps < BELONGS_VIA_MAX_STEPS) {
        const hop = model.relations.find((r) => r.through === null && r.from.tableId === id && r.from.columns.length === 1 && r.from.columns[0] === way.via && r.to.columns.length === 1);
        if (hop === undefined || seen.has(hop.to.tableId)) continue;
        walk(hop.to.tableId, steps + 1, new Set([...seen, id]));
      }
    }
  };
  walk(tableId, 0, new Set());
  return out;
}

export function rowReachIssue(model: EffectiveModel, tableId: string, reach: RowReach): RowLimitIssue | null {
  const table = model.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) return { code: 'no-such-table', message: 'That table is not there.' };
  if (table.private === true) return { code: 'private', message: 'A private table is read by its own people only.' };
  if (table.belongs === undefined && reach.reach !== 'all') return { code: 'no-belongs', message: 'This table does not say whose its rows are.' };
  if (reach.while !== undefined) {
    const column = table.columns.find((candidate) => candidate.name === reach.while?.column);
    if (column === undefined) return { code: 'no-such-column', message: `"${table.label ?? table.name}" has no column "${reach.while.column}".`, column: reach.while.column };
    // A secret is carried by no response; a masked column is shown only to who is granted it by name.
    const flags = column.semantics?.flags;
    if (flags?.secret === true || column.masked === true || column.hidden === true || (column.masked === undefined && flags?.maskedByDefault === true)) {
      return { code: 'hidden-column', message: `"${reach.while.column}" is not shown to everybody who reads the table, so a limit cannot be told by it.`, column: reach.while.column };
    }
  }
  if (reach.via !== undefined) {
    // Judged by a staff column of the row this one hangs off: the link is one of the table's own `via` ways, `by` a staff column of the parent.
    if (reach.by === undefined) return { code: 'via-without-by', message: 'Say which person of the parent row judges the row ("by").', column: reach.via };
    if (reach.unowned === true || reach.reach === 'all') return { code: 'via-without-by', message: 'A reach judged by the parent\'s person is the person\'s own or their team\'s, and takes no rows nobody owns.', column: reach.via };
    if (!(table.belongs ?? []).some((way) => 'via' in way && way.via === reach.via)) return { code: 'not-a-parent', message: `"${table.label ?? table.name}" does not belong through "${reach.via}".`, column: reach.via };
    const hop = model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === reach.via && r.to.columns.length === 1);
    const parent = hop === undefined ? undefined : model.tables.find((candidate) => candidate.id === hop.to.tableId);
    if (parent === undefined) return { code: 'not-a-parent', message: `"${reach.via}" links to no table.`, column: reach.via };
    const person = parent.columns.find((candidate) => candidate.name === reach.by);
    if (person === undefined) return { code: 'no-such-column', message: `"${parent.label ?? parent.name}" has no column "${reach.by}".`, column: reach.by };
    if (person.staff !== true) return { code: 'not-a-staff-column', message: `"${reach.by}" does not hold a staff member, so no row is anybody's by it.`, column: reach.by };
  } else if (reach.by !== undefined) {
    const column = table.columns.find((candidate) => candidate.name === reach.by);
    if (column === undefined) return { code: 'no-such-column', message: `"${table.label ?? table.name}" has no column "${reach.by}".`, column: reach.by };
    if (column.staff !== true) return { code: 'not-a-staff-column', message: `"${reach.by}" does not hold a staff member, so no row is anybody's by it.`, column: reach.by };
  }
  if (reach.notBy !== undefined) {
    // A staff column of the row, or `<link>.<staff column>` of the row one of its links names.
    const [own, far] = reach.notBy.split('.') as [string, string | undefined];
    const column = table.columns.find((candidate) => candidate.name === own);
    if (column === undefined) return { code: 'no-such-column', message: `"${table.label ?? table.name}" has no column "${own}".`, column: reach.notBy };
    if (far === undefined) {
      if (column.staff !== true) return { code: 'not-a-staff-column', message: `"${own}" does not hold a staff member, so it names nobody who may not change the row.`, column: reach.notBy };
    } else {
      const hop = model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === own && r.to.columns.length === 1);
      const linked = hop === undefined ? undefined : model.tables.find((candidate) => candidate.id === hop.to.tableId);
      const person = linked?.columns.find((candidate) => candidate.name === far);
      if (person === undefined) return { code: 'no-such-column', message: `"${own}" names no row with a column "${far}".`, column: reach.notBy };
      if (person.staff !== true) return { code: 'not-a-staff-column', message: `"${far}" does not hold a staff member, so it names nobody who may not change the row.`, column: reach.notBy };
    }
  }
  if (reach.notThrough !== undefined) {
    // A listing the reach does not count: one the table, or a row it hangs off, is read through; on a reach that counts listings at all.
    if (reach.reach === 'all') return { code: 'not-a-listing', message: 'Every row is reached by no listing: there is none to leave out.' };
    if (reach.via !== undefined) return { code: 'not-a-listing', message: 'A reach judged by the parent\'s person counts no listing already.', column: reach.via };
    const listings = listingsOfTable(model, table.id);
    for (const listing of notThroughOf(reach)) {
      if (!listings.has(listing)) {
        const named = model.tables.find((candidate) => candidate.id === listing);
        return { code: 'not-a-listing', message: `"${table.label ?? table.name}" is not read through "${named?.label ?? named?.name ?? listing}".`, listing };
      }
    }
  }
  return null;
}

/** The first thing wrong with a table's whole limit, with the action it is under: each of an action's several reaches is asked. */
export function rowLimitIssue(model: EffectiveModel, tableId: string, limit: RowLimit): (RowLimitIssue & { action: string }) | null {
  for (const [action, reaches] of Object.entries(limit)) {
    for (const reach of rowReachList(reaches)) {
      // A change the person may not make: their read of the rows that name them is theirs as ever.
      if (action === 'read' && reach.notBy !== undefined) return { code: 'not-by-read', message: '"Not by" holds a change: a person still reads the rows that name them.', column: reach.notBy, action };
      // The same of a listing left out: a person listed on a row still reads it.
      if (action === 'read' && reach.notThrough !== undefined) return { code: 'not-through-read', message: 'Leaving a listing out holds a change: a person listed on a row still reads it.', action };
      const issue = rowReachIssue(model, tableId, reach);
      if (issue !== null) return { ...issue, action };
    }
  }
  return null;
}
