// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PEOPLE LISTED ON THE ROW, as somebody a step tells.
 *
 * A table may list people against another table's rows: the people on a
 * deal (`deal_members`), the fitters of a visit's crew (`crew_members`, read
 * through the visit's crew), whoever covers for the deal's owner (`covers`,
 * between two days). The record's table says so in one of its `belongs` ways
 * (`through`), and that is the only listing a step may name: a step to "the
 * people listed in `deal_members`" reads the rows of that listing which name
 * the record, in the same way a row limit reads them, today's day included.
 *
 * BEING LISTED IS NO RIGHT TO BE TOLD. Listing somebody is cheaper than
 * letting them read, so a listed person is told only when, at the moment the
 * step runs, they sign in (not suspended, not invited, not a sample person)
 * and their own roles reach the record for a read (`opensRecord`): a fitter
 * put on a crew whose role reads no visit, a marketer listed on a deal, a rep
 * listed and since given another role, hears nothing. The notice and its
 * mail carry the record's values; nobody who could not open it is shown them.
 *
 * A listing that names nobody tells nobody, and the run says so. A step that
 * names a table the record's table does not list people through fails by
 * name: that is the rule being wrong, not the row being empty.
 */
import { usersRepo } from '@adminium/meta';
import { sql, type SqlBool } from 'kysely';

import type { EffectiveTable } from '../connections/effective-schema.js';
import { venueDayOf } from '../crud/row-limit-context.js';
import { opensRecord } from './record-link.js';
import { ActionFailure, type ActionContext } from './actions/types.js';

/** At most this many people are told through one listing of one record: a list longer than this is a rule gone wrong, said by name. */
export const LISTED_MAX = 100;

/** Who a step to "the people listed" tells: everyone listed (`listed`, before anybody is passed over) and, of them, who may be told. */
export interface ListedFound {
  listed: number;
  told: string[];
}

const blank = (value: unknown): boolean => value === null || value === undefined || String(value).trim() === '';

/** The table a single-column link of `table` points at, and the column of it the link holds. */
function linkTarget(ctx: Pick<ActionContext, 'source'>, table: EffectiveTable, column: string): { table: EffectiveTable; key: string } | null {
  const model = ctx.source!.view.model;
  const links = model.relations.filter((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === column && r.to.columns.length === 1);
  const relation = links.find((r) => r.kind === 'declared-fk') ?? links[0];
  const found = relation === undefined ? undefined : model.tables.find((candidate) => candidate.id === relation.to.tableId);
  return relation === undefined || found === undefined ? null : { table: found, key: relation.to.columns[0]! };
}

/** The ids of the people a listing names for the run's record today, each once, in order. */
export async function listedIdsOf(ctx: Pick<ActionContext, 'meta' | 'source' | 'now'>, listed: string): Promise<string[]> {
  const source = ctx.source;
  if (source === null) throw new ActionFailure('This rule runs for no record, so nobody is listed on it to tell.');
  const way = (source.table.table.belongs ?? []).find((candidate) => 'through' in candidate && candidate.through.table === listed);
  if (way === undefined || !('through' in way)) throw new ActionFailure(`${listed} no longer lists people against ${source.table.id}, so this step has nobody to tell.`);
  const through = way.through;
  const list = source.view.model.tables.find((candidate) => candidate.id === through.table);
  if (list === undefined) throw new ActionFailure(`${listed} is no longer in this database, so this step has nobody to tell.`);
  // Kept out of every rule: a private table's rows are read by the people they belong to, on the screen.
  if (list.private === true) throw new ActionFailure(`${listed} is private, and no rule reads it.`);
  const on = through.on ?? (source.table.primaryKey.length === 1 ? source.table.primaryKey[0] : undefined);
  const has = (table: EffectiveTable, column: string | undefined) => column !== undefined && table.columns.some((candidate) => candidate.name === column);
  if (on === undefined || !has(list, through.link) || !has(list, through.user)) throw new ActionFailure(`${listed} no longer lists people against ${source.table.id} as it did, so this step has nobody to tell.`);
  // Who the listing names: a staff column of it, or (`person`) a link to a row whose staff column names them.
  const person = through.person;
  const target = person === undefined ? null : linkTarget(ctx, list, through.user);
  if (person === undefined ? list.columns.find((column) => column.name === through.user)?.staff !== true : target?.table.columns.find((column) => column.name === person)?.staff !== true) {
    throw new ActionFailure(`${listed}.${through.user} does not name a staff member, so this step has nobody to tell.`);
  }
  const value = source.row[on];
  if (blank(value)) return [];

  const db = source.db;
  let q = db
    .selectFrom(`${list.id} as adm_l` as never)
    .select(sql.ref(`adm_l.${through.user}`).as('adm_who'))
    .where(sql<SqlBool>`${sql.ref(`adm_l.${through.link}`)} = ${value}`)
    .where(sql<SqlBool>`${sql.ref(`adm_l.${through.user}`)} is not null`);
  // Between its two days, either of which may be left open: judged on the business's day, as a row limit judges it.
  if (through.from !== undefined || through.to !== undefined) {
    const today = await venueDayOf(ctx.meta, source.connectionId, new Date(ctx.now));
    for (const [column, sign] of [[through.from, sql`<=`], [through.to, sql`>=`]] as const) {
      if (column === undefined) continue;
      if (list.columns.find((candidate) => candidate.name === column)?.logicalType !== 'date') throw new ActionFailure(`${listed}.${column} is not a date column, so who is listed today cannot be read.`);
      q = q.where(sql<SqlBool>`(${sql.ref(`adm_l.${column}`)} is null or ${sql.ref(`adm_l.${column}`)} ${sign} ${today})`);
    }
  }
  // …and only while a column of it holds what the way names, as a row limit reads it: a member row whose end is set lists nobody.
  const whilst = (through as { while?: { column: string; in?: readonly unknown[]; isNull?: boolean } }).while;
  if (whilst !== undefined) {
    if (!has(list, whilst.column)) return [];
    const ref = sql.ref(`adm_l.${whilst.column}`);
    // Empty text counts as empty, as the row limit reads it; a column of another kind is empty only when it holds nothing.
    const textual = ['text', 'varchar', 'enum', 'uuid'].includes(String(list.columns.find((candidate) => candidate.name === whilst.column)?.logicalType));
    const empty = textual ? sql<SqlBool>`(${ref} is null or ${ref} = '')` : sql<SqlBool>`${ref} is null`;
    if (whilst.isNull !== undefined) q = q.where(whilst.isNull ? empty : sql<SqlBool>`not ${empty}`);
    else if (whilst.in !== undefined && whilst.in.length > 0) q = q.where(sql<SqlBool>`${ref} in (${sql.join(whilst.in as unknown[])})`);
    else return [];
  }
  const rows = (await q.distinct().limit(LISTED_MAX + 1).execute()) as { adm_who: unknown }[];
  let ids = rows.map((row) => row.adm_who).filter((one) => !blank(one));
  if (person !== undefined && target !== null && ids.length > 0) {
    // One link further: the people the listed rows name.
    const named = (await db
      .selectFrom(`${target.table.id} as adm_p` as never)
      .select(sql.ref(`adm_p.${person}`).as('adm_who'))
      .where(sql<SqlBool>`${sql.ref(`adm_p.${target.key}`)} in (${sql.join(ids)})`)
      .execute()) as { adm_who: unknown }[];
    ids = named.map((row) => row.adm_who).filter((one) => !blank(one));
  }
  const out = [...new Set(ids.map((one) => String(one).trim()))].sort();
  if (out.length > LISTED_MAX) throw new ActionFailure(`${listed} lists more than ${String(LISTED_MAX)} people on this record. A rule tells at most ${String(LISTED_MAX)} people through a listing.`);
  return out;
}

/**
 * The people a listing names for the run's record who may be told now: each
 * signs in, and their own roles reach the record for a read. The rule's own
 * reach plays no part.
 */
export async function listedAt(ctx: Pick<ActionContext, 'meta' | 'source' | 'now'>, listed: string): Promise<ListedFound> {
  const ids = await listedIdsOf(ctx, listed);
  const users = usersRepo(ctx.meta);
  const told: string[] = [];
  for (const id of ids) {
    const user = await users.findById(id);
    if (user === null || user.status !== 'active') continue;
    if (await opensRecord(ctx, id)) told.push(id);
  }
  return { listed: ids.length, told };
}
