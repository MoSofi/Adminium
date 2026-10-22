// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which rows of a table a person reaches.
 *
 * A role's read, update or delete of a table may reach only some rows
 * (`rbac/row-limits.ts`): the person's own, their teams', the ones nobody
 * owns, and only while a column holds some value. Whose a row is, is what
 * the table says of it (`EffectiveTable.belongs`): a column that holds a
 * staff member, a table that lists people against the row, or the row a link
 * points at. This file turns the two into ONE boolean expression over a row,
 * for a query to carry — a list, a count, a subquery over a child table, a
 * read by key — so every path asks the same question the same way.
 *
 * `rowLimitFor` answers null when nothing limits the person there: no SQL is
 * built, and the query a caller runs is the one it always ran.
 *
 * IT READS THE WHOLE TABLE, never a caller's view of it: a role that may not
 * see the owner column is still judged by it.
 *
 * IT FAILS CLOSED. A way that names a column or a table the database no
 * longer has, a column that is not marked as holding a staff member, a link
 * that links nothing: that way reaches nobody, and "nobody owns it" is then
 * never true either. A wrong `belongs` hides rows; it never shows one.
 *
 * AN API KEY IS NOBODY. It owns no row and leads no team, so a key whose
 * role is limited on a table reaches none of its rows. So does a permission
 * set built from bare roles, which says nothing of who holds them.
 *
 * A PRIVATE TABLE is read by the people its rows belong to and by nobody
 * else: whoever asks — Super Admin included — is held to their own rows
 * there, whatever their grants say.
 *
 * It imports nothing from `public-api/`: a customer's rows are that layer's
 * business, decided by a key's scope, and never meet this test.
 */
import { ForbiddenError } from '../errors.js';
import { BELONGS_VIA_MAX_STEPS } from '@adminium/manifest';
import { sql, type Expression, type Kysely, type RawBuilder, type SqlBool } from 'kysely';

import type { BelongsWay, EffectiveModel, EffectiveTable } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { PermissionSet } from '../rbac/resolver.js';
import { rowReachesOf, type RowAction, type RowReach } from '../rbac/row-limits.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';

export type { RowAction };

type Db = Kysely<SourceDatabase>;
type Bool = Expression<SqlBool>;

/**
 * A boolean SQL expression over one row, where `alias` is the name the row's
 * table goes by in the query that carries it: the table's own name when it is
 * selected plainly, or the alias it was given. `reads`, when given, is filled
 * with the id of every table the expression selects from: MySQL refuses an
 * UPDATE or a DELETE whose own WHERE reads the table it writes.
 */
export type RowTest = ((db: Db, alias: string, reads?: Set<string>) => Bool) & {
  /**
   * Work out, before a list is read, the sets this test asks about that are
   * small: the deals somebody is listed on, the owners they cover for. The
   * test is then written with those values themselves. Only where it pays
   * (MySQL, which reads a list by an index only for values it is given, and
   * otherwise passes over every row to count them); absent elsewhere. A read
   * that never calls it is as right, and slower.
   */
  prepare?: (db: Db) => Promise<void>;
};

export interface RowLimitContext {
  set: Pick<PermissionSet, 'superAdmin' | 'rowLimits' | 'reach'>;
  connectionId: string;
  /** The whole model: every table and column as the database has them, with what each says of its rows. */
  model: Pick<EffectiveModel, 'tables' | 'relations' | 'dialect'>;
  /** The business's calendar day, `YYYY-MM-DD`: the day a dated listing (cover for a colleague) is judged on. */
  today: string;
  /**
   * Nobody is asking: a job with no requester, a tool with no person behind
   * it. Such a read reaches no row of a table that says whose its rows are
   * (`belongs`, or private) — said outright, rather than left to whichever
   * check upstream happens to stop it first. A table that says nothing of its
   * rows is read as it always was.
   */
  nobody?: true | undefined;
}

/**
 * How ids are handed to the database. A list written out (`IN (?, ?, …)`) is
 * what an index on the owner column is used for, so a team of a few dozen is
 * written out; measured on MySQL over 50,000 rows, a team of 21 packed into
 * one JSON value took 189 ms where the list takes 4. But a test names the
 * ids once per way, per link followed and per role, and again for the read
 * under an update: two thousand people written out each time would pass
 * SQLite's 32,766 bound values, then the others' 65,535. So a list longer
 * than {@link IDS_WRITTEN_OUT}, and any list once one test has written
 * {@link IDS_BUDGET} ids, is bound ONCE as one value the database unpacks.
 */
const IDS_WRITTEN_OUT = 200;
const IDS_BUDGET = 6000;
/** The largest set worked out ahead of a read and written out in its test; a larger one stays a subquery. */
const SET_WRITTEN_OUT = 500;

/** The sets a test asks about, by the order it asks: worked out ahead (`known`), or gathered to be (`asked`). */
interface Sets {
  known: Map<number, readonly (string | number)[]>;
  asked?: { at: number; values: () => Promise<unknown[]> }[];
}

const never = (): RawBuilder<SqlBool> => sql<SqlBool>`1 = 0`;
const always = (): RawBuilder<SqlBool> => sql<SqlBool>`1 = 1`;
const any = (parts: readonly Bool[]): Bool => (parts.length === 0 ? never() : parts.length === 1 ? parts[0]! : sql<SqlBool>`(${sql.join(parts, sql` or `)})`);
const every = (parts: readonly Bool[]): Bool => (parts.length === 0 ? always() : parts.length === 1 ? parts[0]! : sql<SqlBool>`(${sql.join(parts, sql` and `)})`);
const not = (part: Bool): Bool => sql<SqlBool>`not (${part})`;

/** `ref` is one of `ids`, as one bound value the database unpacks itself. */
function amongPacked(ref: RawBuilder<unknown>, ids: readonly string[], dialect: string): Bool {
  if (dialect === 'postgres') return sql<SqlBool>`${ref} = any(${[...ids]}::text[])`;
  const packed = JSON.stringify(ids);
  // MySQL and MariaDB alike: the column's value, as a JSON string, is one of the array's.
  if (dialect === 'mysql') return sql<SqlBool>`json_contains(${packed}, json_quote(${ref}))`;
  return sql<SqlBool>`${ref} in (select value from json_each(${packed}))`;
}

/** A column that holds somebody: not empty, in either of the two ways text is empty. */
const holdsSomeone = (ref: RawBuilder<unknown>): Bool => sql<SqlBool>`(${ref} is not null and ${ref} <> '')`;

const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'varchar', 'enum', 'uuid']);
const WHOLE_NUMBER_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint']);
const NUMBER_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);

/** Whether two columns hold the same kind of value: comparing text with a number is an error on one engine and a guess on another. */
function comparable(a: string, b: string): boolean {
  return a === b || (TEXT_TYPES.has(a) && TEXT_TYPES.has(b)) || (WHOLE_NUMBER_TYPES.has(a) && WHOLE_NUMBER_TYPES.has(b));
}

/** One build of a test: the model it reads, the query handle, and aliases no two subqueries share. */
class Build {
  #aliases = 0;
  /** The ids this test has written out so far. */
  #written = 0;

  /** How many sets this test has asked about so far: the same test asks in the same order every time it is built. */
  #sets = 0;

  constructor(
    readonly db: Db,
    readonly ctx: RowLimitContext,
    readonly reads?: Set<string>,
    readonly sets?: Sets,
  ) {}

  alias(): string {
    this.#aliases += 1;
    return `adm_rl${String(this.#aliases)}`;
  }

  /** A column of the table an alias stands for: the two names quoted apart, so a dot in either is only a dot. */
  ref(alias: string, column: string): RawBuilder<unknown> {
    return sql.id(alias, column);
  }

  /** `ref` is one of `ids`; no ids is no match. */
  among(ref: RawBuilder<unknown>, ids: readonly string[]): Bool {
    if (ids.length === 0) return never();
    if (ids.length === 1) return sql<SqlBool>`${ref} = ${ids[0]}`;
    if (ids.length > IDS_WRITTEN_OUT || this.#written + ids.length > IDS_BUDGET) return amongPacked(ref, ids, this.ctx.model.dialect);
    this.#written += ids.length;
    return sql<SqlBool>`${ref} in (${sql.join(ids)})`;
  }

  /** The kind of value a column of a table holds; undefined for a column it has not. */
  kind(table: EffectiveTable, column: string): string | undefined {
    return table.columns.find((candidate) => candidate.name === column)?.logicalType;
  }

  table(id: string): EffectiveTable | undefined {
    return this.ctx.model.tables.find((candidate) => candidate.id === id);
  }

  /** The table a single-column link of `table` points at, and the column it holds the value of. */
  target(table: EffectiveTable, column: string): { table: EffectiveTable; key: string } | null {
    const links = this.ctx.model.relations.filter((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === column && r.to.columns.length === 1);
    // The database's own foreign key before a link somebody drew.
    const relation = links.find((r) => r.kind === 'declared-fk') ?? links[0];
    if (relation === undefined) return null;
    const found = this.table(relation.to.tableId);
    const key = relation.to.columns[0]!;
    const [mine, theirs] = [this.kind(table, column), found === undefined ? undefined : this.kind(found, key)];
    if (found === undefined || mine === undefined || theirs === undefined || !comparable(mine, theirs)) return null;
    return { table: found, key };
  }

  exists(table: EffectiveTable, alias: string, conditions: readonly Bool[]): Bool {
    this.reads?.add(table.id);
    let sub = this.db.selectFrom(`${table.id} as ${alias}` as never).select(sql.lit(1).as('one'));
    for (const condition of conditions) sub = sub.where(condition);
    // A subquery brings its own brackets: a second pair is a syntax error on SQLite.
    return sql<SqlBool>`exists ${sub}`;
  }

  /**
   * "`outer` is one of the values `column` holds in the rows of `table` that
   * meet `conditions`" — none of which reads the outer row, so the database
   * works the set out once for the whole read, where a test of each row in
   * its turn is worked out once a row (a list's page then costs as many
   * lookups as the rows it passes over). Two-valued: an outer row with no
   * value, and an inner one with none, are no match rather than "unknown", so
   * a test built of these means the same when it is negated.
   */
  within(outer: RawBuilder<unknown>, table: EffectiveTable, alias: string, column: string, conditions: readonly Bool[]): Bool {
    this.reads?.add(table.id);
    const at = this.#sets;
    this.#sets += 1;
    const key = this.ref(alias, column);
    let sub = this.db.selectFrom(`${table.id} as ${alias}` as never).select(key.as('adm_key')).where(sql<SqlBool>`${key} is not null`);
    for (const condition of conditions) sub = sub.where(condition);
    // Worked out ahead and small: the values themselves, which an index is read by.
    const known = this.sets?.known.get(at);
    if (known !== undefined && this.#written + known.length <= IDS_BUDGET) {
      if (known.length === 0) return never();
      this.#written += known.length;
      return sql<SqlBool>`(${outer} is not null and ${outer} in (${sql.join(known)}))`;
    }
    const distinct = sub.distinct().limit(SET_WRITTEN_OUT + 1);
    this.sets?.asked?.push({ at, values: async () => (await distinct.execute()).map((row) => (row as { adm_key: unknown }).adm_key) });
    return sql<SqlBool>`(${outer} is not null and ${outer} in ${sub})`;
  }

  /**
   * "The person this column names is one of `ids`" (or, with no ids asked
   * for, "this column names somebody"). The column is a staff column of
   * `table`; with `person`, a link to a row whose `person` column is one.
   * Null when the way cannot be read as written.
   */
  someone(table: EffectiveTable, alias: string, column: string, person: string | undefined, ids: readonly string[] | 'anybody'): Bool | null {
    const found = table.columns.find((candidate) => candidate.name === column);
    if (found === undefined) return null;
    const judge = (ref: RawBuilder<unknown>): Bool => (ids === 'anybody' ? holdsSomeone(ref) : this.among(ref, ids));
    if (person === undefined) return found.staff === true ? judge(this.ref(alias, column)) : null;
    const linked = this.target(table, column);
    if (linked === null || linked.table.columns.find((candidate) => candidate.name === person)?.staff !== true) return null;
    /*
     * THROUGH A PRIVATE ROW, ONLY ITS OWN PEOPLE. A row hung on a private one
     * (a step of a one-to-one) is reached by the people that row names, as
     * the private row itself is: never by whoever leads them. A manager's
     * team reach does not open the steps of a one-to-one another manager
     * holds with her rep.
     */
    const asked = ids === 'anybody' || linked.table.private !== true ? ids : ids.filter((one) => one === this.ctx.set.reach?.userId);
    if (asked !== 'anybody' && asked.length === 0) return never();
    const judged = (ref: RawBuilder<unknown>): Bool => (asked === 'anybody' ? holdsSomeone(ref) : this.among(ref, asked));
    const inner = this.alias();
    return this.exists(linked.table, inner, [sql<SqlBool>`${this.ref(inner, linked.key)} = ${this.ref(alias, column)}`, judged(this.ref(inner, person))]);
  }

  /** The listing rows that count for this row today (and while their `while` column holds what it names), as conditions on the listing's alias; null when the way cannot be read. */
  listed(table: EffectiveTable, alias: string, way: Extract<BelongsWay, { through: unknown }>['through'], ids: readonly string[] | 'anybody'): { list: EffectiveTable; inner: string; conditions: Bool[]; on: string; own: Bool[] } | null {
    const list = this.table(way.table);
    const on = way.on ?? (table.primaryKey.length === 1 ? table.primaryKey[0] : undefined);
    if (list === undefined || on === undefined) return null;
    const [link, held] = [this.kind(list, way.link), this.kind(table, on)];
    if (link === undefined || held === undefined || !comparable(link, held)) return null;
    const inner = this.alias();
    const who = this.someone(list, inner, way.user, way.person, ids);
    if (who === null) return null;
    // `own`: what a listing row must be by itself, apart from which row of this table it is listed against.
    const own: Bool[] = [who];
    const conditions: Bool[] = [sql<SqlBool>`${this.ref(inner, way.link)} = ${this.ref(alias, on)}`, who];
    // Between its two days, either of which may be left open.
    for (const [column, sign] of [[way.from, sql`<=`], [way.to, sql`>=`]] as const) {
      if (column === undefined) continue;
      // A day, compared with a day: a time of day, or a number, would sort against "today" in an engine's own way.
      if (this.kind(list, column) !== 'date') return null;
      const between = sql<SqlBool>`(${this.ref(inner, column)} is null or ${this.ref(inner, column)} ${sign} ${this.ctx.today})`;
      conditions.push(between);
      own.push(between);
    }
    // …and only while a column of it holds what the way names: a member row whose end is set lists nobody.
    if (way.while !== undefined) {
      const holds = 'in' in way.while ? this.whilst(list, inner, way.while) : this.emptiness(list, inner, way.while.column, way.while.isNull);
      // A column the listing no longer has: the way cannot be read, and reaches nobody.
      if (holds === null) return null;
      conditions.push(holds);
      own.push(holds);
    }
    return { list, inner, conditions, on, own };
  }

  /** "One of `ids` belongs to this row", by any of the table's ways. */
  belongs(table: EffectiveTable, alias: string, ids: readonly string[], steps: number, seen: ReadonlySet<string>): Bool {
    if (ids.length === 0) return never();
    const parts: Bool[] = [];
    for (const way of table.belongs ?? []) {
      if ('column' in way) {
        const who = this.someone(table, alias, way.column, way.person, ids);
        if (who !== null) parts.push(who);
      } else if ('through' in way) {
        // The rows these people are listed against, as one set: this row's value is in it or is not.
        const listing = this.listed(table, alias, way.through, ids);
        if (listing !== null) parts.push(this.within(this.ref(alias, listing.on), listing.list, listing.inner, way.through.link, listing.own));
      } else {
        // Whoever belongs to the row this link points at: followed a few links up, and never round a ring.
        const parent = steps >= BELONGS_VIA_MAX_STEPS ? null : this.target(table, way.via);
        if (parent === null || seen.has(parent.table.id)) continue;
        const inner = this.alias();
        // The parent rows these people belong to, as one set: a child's page is not one parent looked up a row.
        parts.push(this.within(this.ref(alias, way.via), parent.table, inner, parent.key, [this.belongs(parent.table, inner, ids, steps + 1, new Set([...seen, table.id]))]));
      }
    }
    return any(parts);
  }

  /** "Nobody belongs to this row", by every one of the table's ways. A way that cannot be read makes it false. */
  unowned(table: EffectiveTable, alias: string, steps: number, seen: ReadonlySet<string>): Bool {
    const ways = table.belongs ?? [];
    if (ways.length === 0) return never();
    const parts: Bool[] = [];
    for (const way of ways) {
      if ('column' in way) {
        const who = this.someone(table, alias, way.column, way.person, 'anybody');
        if (who === null) return never();
        parts.push(not(who));
      } else if ('through' in way) {
        const listing = this.listed(table, alias, way.through, 'anybody');
        if (listing === null) return never();
        parts.push(not(this.exists(listing.list, listing.inner, listing.conditions)));
      } else {
        const parent = steps >= BELONGS_VIA_MAX_STEPS ? null : this.target(table, way.via);
        if (parent === null || seen.has(parent.table.id)) return never();
        const inner = this.alias();
        // No parent, or a parent that is nobody's.
        const owned = this.exists(parent.table, inner, [sql<SqlBool>`${this.ref(inner, parent.key)} = ${this.ref(alias, way.via)}`, not(this.unowned(parent.table, inner, steps + 1, new Set([...seen, table.id])))]);
        parts.push(sql<SqlBool>`(${this.ref(alias, way.via)} is null or ${not(owned)})`);
      }
    }
    return every(parts);
  }

  /**
   * "The column is empty" (or, with `empty` false, "holds something"): text
   * is empty in either of its two ways, as a staff column is. Null for a
   * column the table has not.
   */
  emptiness(table: EffectiveTable, alias: string, column: string, empty: boolean): Bool | null {
    const kind = this.kind(table, column);
    if (kind === undefined) return null;
    const ref = this.ref(alias, column);
    const holds = TEXT_TYPES.has(kind) ? holdsSomeone(ref) : sql<SqlBool>`${ref} is not null`;
    return empty ? not(holds) : holds;
  }

  /**
   * "The column holds one of these values now." A column the table has not,
   * or a value that is not the column's kind, is no match: text compared with
   * a number matches every row on one engine and none on another.
   */
  whilst(table: EffectiveTable, alias: string, condition: { column: string; in: readonly (string | number | boolean)[] }): Bool {
    const kind = this.kind(table, condition.column);
    if (kind === undefined || condition.in.length === 0) return never();
    const dialect = this.ctx.model.dialect;
    // A yes/no is a boolean on Postgres; SQLite and MySQL keep it as a number, and SQLite binds no boolean at all.
    const yesNo = kind === 'boolean' || (dialect !== 'postgres' && WHOLE_NUMBER_TYPES.has(kind));
    const values: (string | number | boolean)[] = [];
    for (const value of condition.in) {
      if (typeof value === 'string' && TEXT_TYPES.has(kind)) values.push(value);
      else if (typeof value === 'number' && NUMBER_TYPES.has(kind)) values.push(value);
      else if (typeof value === 'boolean' && yesNo) values.push(dialect === 'postgres' ? value : Number(value));
      else return never();
    }
    return sql<SqlBool>`${this.ref(alias, condition.column)} in (${sql.join(values)})`;
  }

  /**
   * "This person path names `me`": a staff column of the row, or (`<link>.<column>`) the staff column of the row
   * one of its links names. Two-valued (an empty column names nobody), so it means the same negated. Null when the
   * path cannot be read as written: a column or a link the database no longer has.
   */
  names(table: EffectiveTable, alias: string, path: string, me: string): Bool | null {
    const [own, far] = path.split('.') as [string, string | undefined];
    if (far === undefined) {
      if (table.columns.find((candidate) => candidate.name === own)?.staff !== true) return null;
      const ref = this.ref(alias, own);
      return every([holdsSomeone(ref), this.among(ref, [me])]);
    }
    return this.someone(table, alias, own, far, [me]);
  }

  /** One role's whole test: who it reaches, and only while. */
  role(table: EffectiveTable, alias: string, reach: RowReach): Bool {
    const who = this.ctx.set.reach;
    const me = who?.userId ?? null;
    if (me === null) return never();
    const parts: Bool[] = [];
    if (reach.reach === 'all') parts.push(always());
    else {
      const ids = reach.reach === 'team' ? [me, ...(who?.ledIds ?? [])] : [me];
      parts.push(any([this.belongs(table, alias, ids, 0, new Set()), ...(reach.unowned === true ? [this.unowned(table, alias, 0, new Set())] : [])]));
      // …and only the rows this staff column names them in: of the notes on a deal they reach, the ones they wrote.
      // A column that is not there, or holds no staff member, names nobody.
      if (reach.by !== undefined) parts.push(this.someone(table, alias, reach.by, undefined, ids) ?? never());
    }
    if (reach.while !== undefined) parts.push(this.whilst(table, alias, reach.while));
    // …and never a row the person themselves is named in by `notBy` (a manager's own target). A path that cannot be read reaches nothing.
    if (reach.notBy !== undefined) {
      const named = this.names(table, alias, reach.notBy, me);
      parts.push(named === null ? never() : not(named));
    }
    return every(parts);
  }
}

/**
 * Whether anything could limit this person on this connection at all: a row
 * limit on one of their grants, or a private table in the model. False for
 * nearly everyone, and then no request reads a clock or builds a test.
 */
export function mayBeRowLimited(set: Pick<PermissionSet, 'rowLimits'>, model: Pick<EffectiveModel, 'tables'>): boolean {
  // A caller that has no model in hand (a bare harness) has no table that could say anything of its rows.
  return set.rowLimits !== undefined || (model?.tables ?? []).some((table) => table.private === true);
}

/** The reaches a person's `action` on a table is held to, one list per test that must pass; empty when nothing holds them. */
function heldTo(ctx: RowLimitContext, table: EffectiveTable, action: RowAction): (readonly RowReach[])[] {
  // Private: the person's own rows, for every action and every principal.
  if (table.private === true) return [[{ reach: 'own' }]];
  if (ctx.set.superAdmin === true) return [];
  const own = rowReachesOf(ctx.set, ctx.connectionId, table.id, action);
  // A row a person may not read is not theirs to change either: the answer to a write would show it.
  const read = action === 'read' ? null : rowReachesOf(ctx.set, ctx.connectionId, table.id, 'read');
  return [own, read].filter((reaches): reaches is readonly RowReach[] => reaches !== null);
}

/**
 * What holds a person who WRITES a row of a table: the reaches of their
 * update there — or, for someone whose update nothing limits, of their read
 * (a person who reads only their own rows does not make one for somebody
 * else). Null when neither is limited: they write as they always did.
 */
export function writerReaches(ctx: RowLimitContext, tableId: string): readonly RowReach[] | null {
  const table = ctx.model.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) return null;
  if (table.private === true) return [{ reach: 'own' }];
  if (ctx.set.superAdmin === true) return null;
  return rowReachesOf(ctx.set, ctx.connectionId, tableId, 'update') ?? rowReachesOf(ctx.set, ctx.connectionId, tableId, 'read');
}

/**
 * The test a row of `tableId` must pass for this person's `action` to reach
 * it, or null when every row is reached.
 */
export function rowLimitFor(ctx: RowLimitContext, tableId: string, action: RowAction): RowTest | null {
  const table = ctx.model.tables.find((candidate) => candidate.id === tableId);
  // A table the model has not is no table to read: asked about by mistake, it reaches nothing rather than everything.
  if (table === undefined) return () => never();
  if (ctx.nobody === true) return table.belongs !== undefined || table.private === true ? () => never() : null;
  const held = heldTo(ctx, table, action);
  if (held.length === 0) return null;
  // Each list: any one role's whole test. Between the lists (the action's own, and the read under it): both.
  const written = (build: Build, alias: string): Bool => every(held.map((reaches) => any(reaches.map((reach) => build.role(table, alias, reach)))));
  let known: Sets['known'] | undefined;
  const test: RowTest = (db, alias, reads) => written(new Build(db, ctx, reads, known === undefined ? undefined : { known }), alias);
  if (ctx.model.dialect === 'mysql') {
    test.prepare = async (db) => {
      if (known !== undefined) return;
      const asked: NonNullable<Sets['asked']> = [];
      written(new Build(db, ctx, undefined, { known: new Map(), asked }), table.name);
      const found = new Map<number, readonly (string | number)[]>();
      await Promise.all(
        asked.map(async (set) => {
          const values = await set.values();
          // Only a set of plain keys, and a small one: anything else stays the subquery it was.
          // …and a whole number only when it is one this runtime holds exactly: a key past 2^53 comes back rounded.
          const plain = (value: unknown): boolean => typeof value === 'string' || (typeof value === 'number' && (!Number.isInteger(value) || Number.isSafeInteger(value)));
          if (values.length <= SET_WRITTEN_OUT && values.every(plain)) found.set(set.at, values as (string | number)[]);
        }),
      );
      known = found;
    };
  }
  return test;
}

/**
 * Every other table a row test of `tableId` reads to say whose a row is: the
 * listings its ways go through, and the parents its links are followed to
 * (with theirs). A figure kept for a while under the test is kept only until
 * one of them is written to: a member row taken off, or ended, is an answer
 * that no longer counts that deal, at once.
 */
export function rowTestTables(model: Pick<EffectiveModel, 'tables' | 'relations'>, tableId: string): string[] {
  const out = new Set<string>();
  const walk = (id: string, steps: number, seen: ReadonlySet<string>): void => {
    const table = model.tables.find((candidate) => candidate.id === id);
    for (const way of table?.belongs ?? []) {
      if ('through' in way) out.add(way.through.table);
      else if ('via' in way && steps < BELONGS_VIA_MAX_STEPS) {
        const relation = model.relations.find((r) => r.through === null && r.from.tableId === id && r.from.columns.length === 1 && r.from.columns[0] === way.via && r.to.columns.length === 1);
        if (relation === undefined || seen.has(relation.to.tableId)) continue;
        out.add(relation.to.tableId);
        walk(relation.to.tableId, steps + 1, new Set([...seen, id]));
      }
    }
  };
  walk(tableId, 0, new Set());
  out.delete(tableId);
  return [...out];
}

/** Whether this person is held to some rows of the table for the action. */
export function isRowLimited(ctx: RowLimitContext, tableId: string, action: RowAction): boolean {
  return rowLimitFor(ctx, tableId, action) !== null;
}

/**
 * The row a caller named by its key, when the person reaches it for
 * `action`. A row they do not reach comes back as a row that is not there:
 * the caller answers both the same way.
 */
export async function fetchVisible(ctx: RowLimitContext, db: Db, table: ResolvedTable, pk: Row, action: RowAction): Promise<Row | undefined> {
  const test = rowLimitFor(ctx, table.id, action);
  let qb = db.selectFrom(table.id).selectAll();
  for (const [column, value] of Object.entries(pk)) {
    qb = qb.where((eb) => eb(db.dynamic.ref(column), '=', value));
  }
  // Selected plainly, a table goes by its own name.
  if (test !== null) qb = qb.where(test(db, table.name));
  const row = await qb.executeTakeFirst();
  return row as Row | undefined;
}

/**
 * The row test as one more condition of an UPDATE or a DELETE of `table`
 * itself, so a row that left the person's reach between the read that
 * judged it and the statement that writes it is not written: the statement
 * matches no row, and the caller answers "not there". Undefined when nothing
 * limits the person — and on MySQL for a table whose test reads the table
 * itself (a row reached through a parent in the same table), which MySQL
 * will not run inside that table's own UPDATE: there the read that judged
 * the row stands alone.
 */
export function rowRefinement(ctx: RowLimitContext | null, db: Db, table: ResolvedTable, action: RowAction): (<Q extends { where: (expression: Bool) => Q }>(query: Q) => Q) | undefined {
  const test = ctx === null ? null : rowLimitFor(ctx, table.id, action);
  if (test === null || ctx === null) return undefined;
  const reads = new Set<string>();
  const condition = test(db, table.name, reads);
  if (ctx.model.dialect === 'mysql' && reads.has(table.id)) return undefined;
  return (query) => query.where(condition);
}

/**
 * A PRIVATE table is kept out of everything that is made from a table's rows
 * and handed on: a file of it, a file brought in to it, a report sent on a
 * schedule, a printed page, a rule. Each of those outlives the request that
 * made it or acts for somebody else, and a row of a private table is read by
 * the people it belongs to, on the screen, and nowhere else. Refused by name
 * — that the table is private is no secret, it is how the app is written —
 * and for everybody, its own people and the Super Admin included.
 */
export function assertNotPrivate(table: { id: string; name?: string | undefined; table?: { private?: true | undefined } | undefined; private?: true | undefined } | null | undefined, what: string): void {
  if (table === null || table === undefined) return;
  if (table.private !== true && table.table?.private !== true) return;
  throw new ForbiddenError(`${table.name ?? table.id} is private: only the people its rows belong to read it, and ${what}.`, 'TABLE_FORBIDDEN', { table: table.id, reason: 'private' });
}
