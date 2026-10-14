// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PERSON ON THE ROW, as somebody a step tells.
 *
 * A step may be addressed to a staff column of the record the run is about
 * (`owner_id`), or to a staff column of the row one of the record's links
 * names (`deal_id.owner_id`: a quote's deal's owner). The column holds the id
 * of somebody who signs in here, or nothing.
 *
 * NOBODY IN THE COLUMN IS NOT A FAILURE. A deal with no owner yet, a link
 * that is empty, a person who has since been removed: the step tells nobody
 * and says so in the run's log, and the run goes on. A step that names a
 * column the table no longer has, or one that is not a staff column, fails by
 * name — that is the rule being wrong, not the row being empty.
 */
import { usersRepo, type MetaDb, type User } from '@adminium/meta';

import type { Row } from '../crud/mask.js';
import { replyToOf } from '../email/send.js';

import { parseRelated } from './related.js';
import { ActionFailure, type ActionContext } from './actions/types.js';

/** Who a staff column of the run's record names, or why nobody. */
export type StaffFound = { user: User } | { nobody: 'empty' | 'gone' | 'away' };

/**
 * The names of the people the record's staff columns name, and those of the
 * related rows the run has read: by id, as Adminium keeps them. One read of
 * each person, whatever their status: a name is said, nobody is told.
 */
export async function staffNamesOf(meta: MetaDb, source: Pick<NonNullable<ActionContext['source']>, 'table' | 'row' | 'related'>): Promise<Map<string, string>> {
  const ids = new Set<string>();
  const take = (table: { table: { columns: readonly { name: string; staff?: boolean | undefined }[] } }, row: Row | null) => {
    for (const column of table.table.columns) {
      const value = column.staff === true ? row?.[column.name] : undefined;
      if (value !== null && value !== undefined && String(value).trim() !== '') ids.add(String(value));
    }
  };
  take(source.table, source.row);
  for (const far of source.related?.values() ?? []) take(far.table, far.row);
  const users = usersRepo(meta);
  const out = new Map<string, string>();
  for (const id of ids) {
    const user = await users.findById(id);
    if (user !== null) out.set(id, user.name);
  }
  return out;
}

/** Whether a column of a table holds a staff member. */
function isStaff(table: { table: { columns: readonly { name: string; staff?: boolean | undefined }[] } }, column: string): boolean {
  return table.table.columns.some((candidate) => candidate.name === column && candidate.staff === true);
}

/** The id a staff column path holds for this run's record: its own column, or one of a linked row. */
export function staffIdAt(ctx: Pick<ActionContext, 'source'>, path: string): string | null {
  const source = ctx.source;
  if (source === null) throw new ActionFailure('This rule runs for no record, so there is no person on it to tell.');
  const related = parseRelated(path);
  if (related !== null) {
    const far = source.related?.get(related.link);
    if (far === undefined) throw new ActionFailure(`${source.table.id} no longer links ${related.link} to another table, so this step has nobody to tell.`);
    if (!isStaff(far.table, related.column)) throw new ActionFailure(`${far.table.id}.${related.column} does not hold a staff member, so this step has nobody to tell.`);
    const value = far.row?.[related.column];
    return value === null || value === undefined || String(value).trim() === '' ? null : String(value);
  }
  if (!isStaff(source.table, path)) throw new ActionFailure(`${source.table.id}.${path} does not hold a staff member, so this step has nobody to tell.`);
  const value = source.row[path];
  return value === null || value === undefined || String(value).trim() === '' ? null : String(value);
}

/**
 * The person a step tells. Somebody who cannot sign in is told nothing: a
 * suspended account, and a sample person (who has no real address).
 */
export async function staffAt(meta: MetaDb, ctx: Pick<ActionContext, 'source'>, path: string): Promise<StaffFound> {
  const id = staffIdAt(ctx, path);
  if (id === null) return { nobody: 'empty' };
  const user = await usersRepo(meta).findById(id);
  if (user === null) return { nobody: 'gone' };
  if (user.status !== 'active') return { nobody: 'away' };
  return { user };
}

/**
 * WHERE A REPLY GOES (`replyTo: {staff}` on an email step): the address the
 * person on the row signs in with, read now, or null — and null is never a
 * reason to stop the mail. Nobody in the column, somebody removed, suspended
 * or a sample person, an address that is not one plain address, a column
 * that is no longer a staff column: the mail goes without the header.
 */
export async function staffReplyTo(meta: MetaDb, ctx: Pick<ActionContext, 'source'>, path: string | undefined): Promise<string | null> {
  if (path === undefined) return null;
  try {
    const found = await staffAt(meta, ctx, path);
    return 'user' in found ? replyToOf(found.user.email) : null;
  } catch (error) {
    if (error instanceof ActionFailure) return null;
    throw error;
  }
}
