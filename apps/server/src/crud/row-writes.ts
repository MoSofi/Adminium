// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a write is held to when its writer reaches only some rows.
 *
 * `row-limit.ts` says which rows a person reaches. A write could still walk
 * round that in two ways, and this file closes both:
 *
 * A LINK. A follow-up attached to a colleague's deal is a row made inside a
 * record the writer cannot see — and whatever the write copies from that
 * deal, counts on it, or shows beside it, is the colleague's. So a link
 * written to a table the writer reads only in part must name a row they
 * reach. One they do not reach is refused exactly as a row that is not
 * there: the same words, and nothing of the database's own sentence.
 *
 * A PERSON. A row is somebody's by the staff column that names them. A rep
 * who could write any name there could take a colleague's deal, or leave one
 * of their own on a colleague's desk. So each staff column a limited writer
 * sets follows what the table says of it (`belongs[].set`): themselves; or
 * themselves and the people of the teams they lead; or anyone. Emptying it — making the row
 * nobody's — needs a reach that includes the rows nobody owns. A record's own
 * hand-over button is the one way to name anybody.
 *
 * Whoever writes, a staff column holds a person who can sign in, or nothing.
 *
 * Nothing here runs for a writer nothing limits and a table with no staff
 * column: the checks return before they read anything.
 */
import { teamsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { BelongsWay, EffectiveTable } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ConflictError, ForbiddenError, ValidationFailedError } from '../errors.js';
import type { Row } from './mask.js';
import { rowLimitFor, writerReaches, type RowLimitContext } from './row-limit.js';

type Db = Kysely<SourceDatabase>;

const empty = (value: unknown): boolean => value === null || value === undefined || value === '';
const same = (a: unknown, b: unknown): boolean => a === b || (a != null && b != null && String(a) === String(b)) || (empty(a) && empty(b));

const TEXTS: ReadonlySet<string> = new Set(['text', 'varchar', 'enum', 'uuid']);
const WHOLE: ReadonlySet<string> = new Set(['integer', 'bigint']);
/** Whether two columns hold the same kind of value, so one can be looked up by the other. */
const sameKind = (a: string, b: string): boolean => a === b || (TEXTS.has(a) && TEXTS.has(b)) || (WHOLE.has(a) && WHOLE.has(b));

/** A link that names no row: what the database answers a foreign key that points at nothing, with its own sentence left out. */
export function linkRefused(): ConflictError {
  return new ConflictError('The change violates a foreign-key constraint.', 'FK_VIOLATION', { constraint: null, detail: null });
}

/** The same for a link into an add-on's table, which no foreign key backs: the field, and that nothing is there. */
function softLinkRefused(column: string): ValidationFailedError {
  return new ValidationFailedError('Some values were refused.', { fields: { [column]: { code: 'not-found' } } });
}

/** Where columns of a table point: a foreign key's table and key (one column or several), or an add-on's. */
interface LinkTarget {
  columns: string[];
  tableId: string;
  keys: string[];
  soft: boolean;
}

function linkTargets(ctx: RowLimitContext, table: EffectiveTable): LinkTarget[] {
  const out: LinkTarget[] = [];
  const kindOf = (tableId: string, column: string): string | undefined => ctx.model.tables.find((candidate) => candidate.id === tableId)?.columns.find((candidate) => candidate.name === column)?.logicalType;
  for (const relation of ctx.model.relations) {
    if (relation.through !== null || relation.from.tableId !== table.id || relation.from.columns.length === 0 || relation.from.columns.length !== relation.to.columns.length) continue;
    // A column that holds a person holds no link, whatever its name made a guesser think (`manager_id`).
    if (relation.from.columns.some((column) => table.columns.find((candidate) => candidate.name === column)?.staff === true)) continue;
    // A link somebody GUESSED between a number and a text is no link: nothing could match, and asking would be an error on
    // one engine. A foreign key the database itself keeps is always asked about, whatever the two columns are.
    const kinds = relation.from.columns.map((column, i) => [kindOf(table.id, column), kindOf(relation.to.tableId, relation.to.columns[i]!)] as const);
    if (relation.kind !== 'declared-fk' && kinds.some(([mine, theirs]) => mine === undefined || theirs === undefined || !sameKind(mine, theirs))) continue;
    out.push({ columns: [...relation.from.columns], tableId: relation.to.tableId, keys: [...relation.to.columns], soft: false });
  }
  for (const column of table.columns) {
    const link = column.addOnLink;
    if (link !== undefined && link.tableId !== null && link.key !== null) out.push({ columns: [column.name], tableId: link.tableId, keys: [link.key], soft: true });
  }
  return out;
}

/** Whether a row of `tableId` with these key values is one the person reaches for a read. */
export async function reachesKey(ctx: RowLimitContext, db: Db, tableId: string, key: string | readonly string[], value: unknown): Promise<boolean> {
  const test = rowLimitFor(ctx, tableId, 'read');
  const name = tableId.slice(tableId.lastIndexOf('.') + 1);
  const keys = typeof key === 'string' ? [key] : key;
  const values = typeof key === 'string' ? [value] : (value as readonly unknown[]);
  let query = db.selectFrom(tableId as never).select(sql.lit(1).as('one'));
  for (const [i, column] of keys.entries()) query = query.where(sql.ref(column), '=', values[i] as never);
  if (test !== null) query = query.where(test(db, name));
  return (await query.limit(1).executeTakeFirst()) !== undefined;
}

/**
 * Refuse a write whose link names a row the writer does not reach. Judged
 * only for a link being SET — a new row's, or one this change moves — to a
 * table the writer reads in part; a link left as it is was judged when the
 * row was read.
 */
export async function assertLinksReached(ctx: RowLimitContext | null, db: Db, tableId: string, values: Row, before: Row | null): Promise<void> {
  if (ctx === null) return;
  const table = ctx.model.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) return;
  for (const link of linkTargets(ctx, table)) {
    // Set by this write: one of its columns is sent, with a value the stored row does not already hold there.
    const sent = link.columns.filter((column) => Object.prototype.hasOwnProperty.call(values, column));
    if (sent.length === 0 || (before !== null && sent.every((column) => same(values[column], before[column])))) continue;
    // The whole key as the row will hold it: what was sent, over what is stored. A link with an empty part points nowhere.
    const whole = link.columns.map((column) => (Object.prototype.hasOwnProperty.call(values, column) ? values[column] : before?.[column]));
    if (whole.some((value) => empty(value))) continue;
    if (rowLimitFor(ctx, link.tableId, 'read') === null) continue;
    if (!(await reachesKey(ctx, db, link.tableId, link.keys, whole))) throw link.soft ? softLinkRefused(link.columns[0]!) : linkRefused();
  }
}

/** The keys among `keys` of rows of a table the person reaches for a read; every key when nothing limits them there. */
export async function reachedKeys(ctx: RowLimitContext | null, db: Db, tableId: string, key: string, keys: readonly unknown[]): Promise<Set<string>> {
  const all = new Set(keys.map((value) => String(value)));
  const test = ctx === null ? null : rowLimitFor(ctx, tableId, 'read');
  if (test === null || keys.length === 0) return all;
  const name = tableId.slice(tableId.lastIndexOf('.') + 1);
  const out = new Set<string>();
  for (let at = 0; at < keys.length; at += 200) {
    const rows = await db
      .selectFrom(tableId as never)
      .select(sql.ref(key).as('key'))
      .where(sql.ref(key), 'in', keys.slice(at, at + 200) as never)
      .where(test(db, name))
      .execute();
    for (const row of rows) out.add(String((row as { key: unknown }).key));
  }
  return out;
}

/** What the table says a limited writer may put in a staff column: its way's `set`, `anyone` for a column no way names. */
function setRuleOf(table: EffectiveTable, column: string): { set: 'self' | 'team' | 'anyone'; person?: string } {
  const way = (table.belongs ?? []).find((candidate): candidate is Extract<BelongsWay, { column: string }> => 'column' in candidate && candidate.column === column);
  if (way === undefined) return { set: 'anyone' };
  return { set: way.set ?? 'self', ...(way.person === undefined ? {} : { person: way.person }) };
}

export interface StaffWriteOptions {
  /** A record's own hand-over: any person who can sign in may be named. */
  handOver?: boolean | undefined;
}

/**
 * Judge the people a write names. `values` is what the writer sent (never
 * what a rule fills: a stamp of the writer's own id is the rule's doing);
 * `before` the stored row, or null for a new one. A column sent with the
 * value the row already holds is no change.
 */
export async function assertStaffColumns(ctx: RowLimitContext | null, meta: MetaDb, db: Db, model: { tables: readonly EffectiveTable[]; relations: RowLimitContext['model']['relations'] }, tableId: string, values: Row, before: Row | null, opts: StaffWriteOptions = {}): Promise<void> {
  const table = model.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) return;
  const reaches = ctx === null ? null : writerReaches(ctx, tableId);
  const me = ctx?.set.reach?.userId ?? null;
  // The people of the teams the writer leads: read here when a column asks it, since a permission set carries them
  // only for somebody whose own rows are "the team's" (a manager's one-to-ones are their own, and name a person they lead).
  let led: Set<string> | null = null;
  const leads = async (id: string): Promise<boolean> => {
    led ??= new Set(me === null ? [] : (await teamsRepo(meta).leadReach(me)).ids);
    return led.has(id);
  };
  const refuse = (column: string, reason: string): never => {
    throw new ForbiddenError(`Your role may not put that person in ${column} on this table.`, 'COLUMN_FORBIDDEN', { table: tableId, column, reason });
  };
  for (const [column, value] of Object.entries(values)) {
    const found = table.columns.find((candidate) => candidate.name === column);
    if (found === undefined || (before !== null && same(value, before[column]))) continue;
    const rule = setRuleOf(table, column);
    // A link to a person's row: who that row holds is who is being named.
    const viaPerson = rule.person !== undefined && found.staff !== true;
    if (found.staff !== true && !viaPerson) continue;
    let named: unknown = value;
    if (viaPerson && !empty(value)) {
      // Only a limited writer is asked whom the row holds: for anyone else the link is a link.
      if (reaches === null) continue;
      const relation = model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === column && r.to.columns.length === 1);
      if (relation === undefined) refuse(column, 'staff-column');
      const held = await db.selectFrom(relation!.to.tableId as never).select(sql.ref(rule.person!).as('person')).where(sql.ref(relation!.to.columns[0]!), '=', value as never).limit(1).executeTakeFirst();
      // No such row is the link's own refusal, told by the link check or the database.
      if (held === undefined) continue;
      named = (held as { person: unknown }).person;
    }
    if (empty(named)) {
      // Nobody's: a row a limited writer could then not see, unless their reach includes those.
      if (reaches !== null && !reaches.some((reach) => reach.reach === 'all' || reach.unowned === true)) refuse(column, 'staff-column');
      continue;
    }
    if (!viaPerson) {
      const user = typeof named === 'string' ? await usersRepo(meta).findById(named) : null;
      if (user === null || user.status === 'suspended') throw new ValidationFailedError('Some values were refused.', { fields: { [column]: { code: 'not-found' } } });
    }
    if (reaches === null || opts.handOver === true || rule.set === 'anyone') continue;
    // An API key is nobody: it names nobody either.
    if (me === null) refuse(column, 'staff-column');
    if (named !== me && !(rule.set === 'team' && (await leads(String(named))))) refuse(column, 'staff-column');
  }
}

/**
 * Refuse a delete of a row that rows the person does NOT reach still hang
 * off. Where the database would carry them away with it (a cascade) or
 * detach them, the person would be deleting or changing rows that are not
 * theirs; where it would refuse, its refusal would count them. So it is
 * refused here first, in the words of any link that still holds — and
 * nothing says how many, or whose.
 */
export async function assertNoUnreachedChildren(ctx: RowLimitContext | null, db: Db, tableId: string, row: Row): Promise<void> {
  if (ctx === null) return;
  for (const relation of ctx.model.relations) {
    if (relation.through !== null || relation.to.tableId !== tableId || relation.from.columns.length !== 1 || relation.to.columns.length !== 1) continue;
    const test = rowLimitFor(ctx, relation.from.tableId, 'read');
    const value = row[relation.to.columns[0]!];
    if (test === null || empty(value)) continue;
    const name = relation.from.tableId.slice(relation.from.tableId.lastIndexOf('.') + 1);
    const hidden = await db
      .selectFrom(relation.from.tableId as never)
      .select(sql.lit(1).as('one'))
      .where(sql.ref(relation.from.columns[0]!), '=', value as never)
      // "Not reached" must also catch a row the test cannot decide (an empty owner compares as unknown, and `not unknown` matches nothing).
      .where(sql<boolean>`(case when ${test(db, name)} then 0 else 1 end) = 1`)
      .limit(1)
      .executeTakeFirst();
    if (hidden !== undefined) throw linkRefused();
  }
}
