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
 * A ROW THAT IS ITS PARENT'S OWNER'S. A table may say its rows are whoever
 * owns the row they hang off: a staff column kept as a copy of the parent's
 * (`copy … mode: always`), named in `belongs`. The writer never sends that
 * column, so the person is judged where the writer does choose: at the link.
 * Somebody held to some rows hangs such a row only under a parent that
 * names them (or somebody they lead, where the table says `set: team`) — a
 * helper on a colleague's deal, or whoever covers for its owner, works on
 * the deal and adds nobody to it.
 *
 * A ROW HUNG UNDER A PARENT IS HUNG WHERE ITS OWN TABLE'S REACH REACHES.
 * A table whose rows are whoever's their parent is (`via`) is read, by
 * somebody held to their own rows of it, under the parents that are theirs.
 * The link check asks only whether the writer READS the parent, and that
 * may be wider: an account manager reads every won deal, and comments only
 * on a deal he is on. So the link is also judged by the reach the writer has
 * of the row's own table: the parent is theirs (or somebody's they lead), or
 * nobody's where they reach the rows nobody owns. A comment hung on a won
 * deal he is not on would be a comment he could not read back, and its
 * mentions would tell people about a deal in his name.
 *
 * A LISTING NAMES SOMEBODY WHO CAN OPEN WHAT IT LISTS THEM ON. A table other
 * tables are read through (the people on a deal, who covers whom) holds, in
 * its person column, only somebody who reads at least one of those tables.
 * Anybody else would be listed against rows they cannot open today, and
 * would reach them unasked the day a role is added. This holds for every
 * writer, limited or not.
 *
 * Nothing here runs for a writer nothing limits and a table with no staff
 * column: the checks return before they read anything.
 */
import { teamsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { rowReachesOf } from '../rbac/row-limits.js';
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

/** What a table goes by when it is selected plainly: its own name, as the model has it. */
const nameOf = (ctx: RowLimitContext, tableId: string): string => ctx.model.tables.find((candidate) => candidate.id === tableId)?.name ?? tableId.slice(tableId.lastIndexOf('.') + 1);

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
  const name = nameOf(ctx, tableId);
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
  await assertParentReached(ctx, db, table, values, before);
}

/**
 * Refuse a write that hangs a row of a table read through its parent
 * (`via`) under a parent the writer's reach of THIS table does not reach
 * (see the header). Judged only when the write sets or moves such a link,
 * for a writer held to some rows of the table, and only where the table says
 * nothing else that could make the row theirs: a staff column that names
 * them makes it theirs whatever its parent; a way through a listing, or
 * through a person's row, is not judged here (a new row is listed nowhere
 * yet), and then the write is as it always was.
 */
async function assertParentReached(ctx: RowLimitContext, db: Db, table: EffectiveTable, values: Row, before: Row | null): Promise<void> {
  const ways = table.belongs ?? [];
  const vias = ways.filter((way): way is Extract<BelongsWay, { via: string }> => 'via' in way);
  if (vias.length === 0 || ways.some((way) => 'through' in way || ('column' in way && way.person !== undefined))) return;
  // Set by this write: sent, with a value the stored row does not already hold there.
  const moved = vias.filter((way) => Object.prototype.hasOwnProperty.call(values, way.via) && (before === null || !same(values[way.via], before[way.via])));
  if (moved.length === 0) return;
  const reaches = writerReaches(ctx, table.id);
  // Nothing limits them here, or a reach of every row (only while a column of the row holds a value) hangs it anywhere they read.
  if (reaches === null || reaches.some((reach) => reach.reach === 'all')) return;
  const me = ctx.set.reach?.userId ?? null;
  if (me === null) throw linkRefused();
  const ids = new Set([me, ...(reaches.some((reach) => reach.reach === 'team') ? (ctx.set.reach?.ledIds ?? []) : [])]);
  // Theirs by a staff column of its own: as the row will hold it, or as a stamp of its maker will fill it.
  for (const way of ways) {
    if (!('column' in way)) continue;
    const column = table.columns.find((candidate) => candidate.name === way.column);
    // A copy of the parent's person says whose the parent is: that is the question asked below, not an answer to it.
    if (column?.copy?.mode === 'always') continue;
    const stamp = column?.stamp as { set?: unknown; on?: unknown } | undefined;
    const held = Object.prototype.hasOwnProperty.call(values, way.column) ? values[way.column] : before === null ? (stamp?.set === 'user-id' && stamp.on === 'create' ? me : undefined) : before[way.column];
    if (!empty(held) && ids.has(String(held))) return;
  }
  // Theirs through a parent: any one of its links, as the row will hold them, names a parent their reach of this table reaches.
  const asParent: RowLimitContext = {
    ...ctx,
    nobody: undefined,
    set: {
      superAdmin: false,
      reach: ctx.set.reach,
      // The person's reaches of THIS table, asked of the parent: who it belongs to. A `while` or a `by` reads this table's own columns.
      rowLimits: { read: [{ limited: [], unlimited: new Set<string>() }] },
    },
  };
  for (const way of vias) {
    const link = Object.prototype.hasOwnProperty.call(values, way.via) ? values[way.via] : before?.[way.via];
    if (empty(link)) continue;
    const relation = ctx.model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === way.via && r.to.columns.length === 1);
    if (relation === undefined) continue;
    const parentId = relation.to.tableId;
    const limited = reaches.map((reach) => ({ grant: `table:${ctx.connectionId}:${parentId}:read`, reach: { reach: reach.reach, ...(reach.unowned === true ? { unowned: true as const } : {}) } }));
    const judged = { ...asParent, set: { ...asParent.set, rowLimits: { read: [{ limited, unlimited: new Set<string>() }] } } };
    if (await reachesKey(judged, db, parentId, relation.to.columns[0]!, link)) return;
  }
  const column = moved[0]!.via;
  throw new ForbiddenError('Your role adds here only under a record that is yours.', 'COLUMN_FORBIDDEN', { table: table.id, column, reason: 'parent-not-theirs' });
}

/** Who is writing, as the link check needs them where no role limits their rows: what they read, and who they are. */
export interface LinkWriter {
  /** Whether the writer holds the read of a table at all. */
  reads: (tableId: string) => boolean;
  /** The person, or null for a key with no person behind it: nobody's rows are theirs. */
  userId: string | null;
  /** The business's calendar day, for a way that holds between two dates. */
  today: () => Promise<string>;
}

/**
 * Refuse a write whose link names a row of a table THE WRITER DOES NOT READ
 * AT ALL, unless the row is theirs.
 *
 * `assertLinksReached` judges a link into a table the writer reads in part.
 * Somebody who holds no read of the table was judged by nothing: a link is
 * then a way to hang a row on a record they cannot open — a sign-off written
 * against another crew's job stops the real one — and whatever the new row
 * copies from that record is read through it.
 *
 * So, for a table that says whose its rows are (`belongs`, or private): a
 * writer with no read of it may still name a row that is THEIRS by the
 * table's own ways, and no other. One that is not theirs is refused exactly
 * as a row that is not there. A table that says nothing of its rows is as it
 * always was: its key is a key, to anybody who may write the linking row.
 *
 * Only for a link being SET by this write, as above.
 */
export async function assertLinksToUnreadTables(model: RowLimitContext['model'], connectionId: string, writer: LinkWriter, db: Db, tableId: string, values: Row, before: Row | null): Promise<void> {
  const table = model.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) return;
  let own: RowLimitContext | null = null;
  for (const link of linkTargets({ model } as RowLimitContext, table)) {
    const target = model.tables.find((candidate) => candidate.id === link.tableId);
    if (target === undefined || (target.belongs === undefined && target.private !== true)) continue;
    const sent = link.columns.filter((column) => Object.prototype.hasOwnProperty.call(values, column));
    if (sent.length === 0 || (before !== null && sent.every((column) => same(values[column], before[column])))) continue;
    const whole = link.columns.map((column) => (Object.prototype.hasOwnProperty.call(values, column) ? values[column] : before?.[column]));
    if (whole.some((value) => empty(value))) continue;
    // A table they read, whole or in part, is the check above's.
    if (writer.reads(link.tableId)) continue;
    // Theirs by the table's own ways: asked as somebody held to their own rows there, and to nothing wider.
    own ??= {
      set: {
        superAdmin: false,
        rowLimits: { read: [{ limited: model.tables.map((one) => ({ grant: `table:${connectionId}:${one.id}:read`, reach: { reach: 'own' as const } })), unlimited: new Set<string>() }] },
        reach: { userId: writer.userId, ledIds: [] },
      },
      connectionId,
      model,
      today: await writer.today(),
    };
    if (!(await reachesKey(own, db, link.tableId, link.keys, whole))) throw link.soft ? softLinkRefused(link.columns[0]!) : linkRefused();
  }
}

/** The keys among `keys` of rows of a table the person reaches for a read; every key when nothing limits them there. */
export async function reachedKeys(ctx: RowLimitContext | null, db: Db, tableId: string, key: string, keys: readonly unknown[]): Promise<Set<string>> {
  const all = new Set(keys.map((value) => String(value)));
  const test = ctx === null ? null : rowLimitFor(ctx, tableId, 'read');
  if (ctx === null || test === null || keys.length === 0) return all;
  const name = nameOf(ctx, tableId);
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
  /** The connection the table is in: with it, a listing's person is asked whether they read what the listing opens. */
  connectionId?: string | undefined;
  /**
   * A new row saved under a record that is already there, before its link to that record is written: the caller
   * judges it again with the link, so whose the parent is is asked then and not here.
   */
  parentLater?: boolean | undefined;
  /** A new row saved under a record this same save makes: what that record was sent (its owner is whose the row will be). */
  parentValues?: Row | undefined;
}

/** The tables read through this one, by the person its `column` holds (a listing with a link to a person's row is not asked). */
function readThrough(model: { tables: readonly EffectiveTable[] }, tableId: string, column: string): EffectiveTable[] {
  return model.tables.filter((other) => (other.belongs ?? []).some((way) => 'through' in way && way.through.table === tableId && way.through.user === column && way.through.person === undefined));
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
  /*
   * WHOSE THE ROW IS, AND WHO MAY SAY SO. The columns a table's own ways name
   * decide whose a row is. Somebody who reaches a row another way — listed
   * on it as a helper, covering for its owner, or through its parent — works
   * on it, and does not give it away: only a person the stored row names in
   * one of those columns (or who leads that person, where the writer's reach
   * is their team's) changes one. A row that is nobody's is taken by whoever
   * reaches the rows nobody owns. A record's hand-over button frees WHOM the
   * row may go to, not who may hand it over.
   */
  const deciding = new Set((table.belongs ?? []).flatMap((way) => ('column' in way && way.person === undefined ? [way.column] : [])));
  /** A deciding column kept as a copy of the parent's: the link decides it, and nothing a writer sends there counts. */
  const keptCopy = (column: string): { via: string; from: string } | undefined => {
    const copy = table.columns.find((candidate) => candidate.name === column)?.copy;
    return copy?.mode === 'always' ? copy : undefined;
  };
  const underParent = opts.parentLater === true || opts.parentValues !== undefined;
  /*
   * A reach of every row (only while a column holds some values) holds a
   * stored row only when the row is one it reaches. Beside another reach —
   * every won deal, and their own — the row a write names may be reached by
   * the other one alone: an open deal somebody only helps on is not theirs
   * to take because they also read every won one.
   */
  const reachesWhole = (row: Row): boolean => (reaches ?? []).some((reach) => reach.reach === 'all' && (reach.while === undefined || reach.while.in.some((value) => same(value, row[reach.while!.column]))));
  let holds: boolean | null = null;
  const holdsItself = async (): Promise<boolean> => {
    if (holds !== null) return holds;
    if (before === null || reaches === null) return (holds = true);
    if (reachesWhole(before)) return (holds = true);
    const people = [...deciding].map((column) => before[column]).filter((value) => !empty(value)).map((value) => String(value));
    if (people.length === 0) return (holds = reaches.some((reach) => reach.unowned === true));
    if (me !== null && people.includes(me)) return (holds = true);
    if (reaches.some((reach) => reach.reach === 'team')) for (const person of people) if (await leads(person)) return (holds = true);
    return (holds = false);
  };
  /*
   * A NEW ROW IS SOMEBODY'S. A row made with nobody in any column that says
   * whose it is, is nobody's: its own writer could not read it back, and
   * everybody whose reach includes the rows nobody owns would. So a writer
   * held to some rows names somebody as they make one — unless their reach
   * includes the rows nobody owns (an inbox, a shared view), or a rule of the
   * table puts the writer there itself. Told as a field that is missing, so
   * a form marks it.
   */
  if (before === null && reaches !== null && deciding.size > 0 && !reaches.some((reach) => reach.reach === 'all' || reach.unowned === true)) {
    const filledByRule = (column: string): boolean => {
      const found = table.columns.find((candidate) => candidate.name === column);
      const stamp = found?.stamp as { set?: unknown; on?: unknown } | undefined;
      // …or a copy of the parent's: the row is whoever's the parent is, and the link below is where that is judged.
      const kept = keptCopy(column);
      return (stamp?.set === 'user-id' && stamp.on === 'create') || (kept !== undefined && (!empty(values[kept.via]) || underParent));
    };
    // What a writer sends in a column a copy keeps is thrown away by the copy: it names nobody.
    if (![...deciding].some((column) => (keptCopy(column) === undefined && !empty(values[column])) || filledByRule(column))) {
      throw new ValidationFailedError('Say whose this is: a row that is nobody\'s is one you could not open again.', { fields: { [[...deciding][0]!]: { code: 'required' } } });
    }
  }
  /*
   * WHOSE THE PARENT IS. A deciding column kept as a copy of the parent's is
   * set by the link, so the link is judged as the column would be: the row
   * goes under a parent that names the writer (or somebody they lead), and
   * is moved to another only by somebody the stored row names.
   */
  if (reaches !== null && opts.handOver !== true) {
    const judgeOwner = async (via: string, column: string, named: unknown): Promise<void> => {
      const rule = setRuleOf(table, column);
      if (rule.set === 'anyone') return;
      if (empty(named)) {
        if (!reaches.some((reach) => reach.reach === 'all' || reach.unowned === true)) refuse(via, 'parent-not-theirs');
        return;
      }
      if (me === null) refuse(via, 'parent-not-theirs');
      if (String(named) !== me && !(rule.set === 'team' && (await leads(String(named))))) refuse(via, 'parent-not-theirs');
    };
    for (const column of deciding) {
      const copy = keptCopy(column);
      if (copy === undefined) continue;
      const relation = model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === copy.via && r.to.columns.length === 1);
      if (!Object.prototype.hasOwnProperty.call(values, copy.via)) {
        // A new row under a record this same save makes: whose that record will be is whose the row will be.
        if (before === null && opts.parentValues !== undefined) {
          const parentTable = relation === undefined ? undefined : model.tables.find((candidate) => candidate.id === relation.to.tableId);
          const stamp = parentTable?.columns.find((candidate) => candidate.name === copy.from)?.stamp as { set?: unknown; on?: unknown } | undefined;
          const sent = opts.parentValues[copy.from];
          await judgeOwner(copy.via, column, empty(sent) && stamp?.set === 'user-id' && stamp.on === 'create' ? me : sent);
        }
        continue;
      }
      const link = values[copy.via];
      if (before !== null && same(link, before[copy.via])) continue;
      if (!(await holdsItself())) refuse(copy.via, 'not-theirs-to-give');
      // No parent named: the new-row check above, or the column's own rule, answers that.
      if (empty(link)) continue;
      if (setRuleOf(table, column).set === 'anyone') continue;
      if (relation === undefined) refuse(copy.via, 'parent-not-theirs');
      const parent = await db.selectFrom(relation!.to.tableId as never).select(sql.ref(copy.from).as('person')).where(sql.ref(relation!.to.columns[0]!), '=', link as never).limit(1).executeTakeFirst();
      // No such row is the link's own refusal, told by the link check or the database.
      if (parent === undefined) continue;
      await judgeOwner(copy.via, column, (parent as { person: unknown }).person);
    }
  }
  for (const [column, value] of Object.entries(values)) {
    const found = table.columns.find((candidate) => candidate.name === column);
    if (found === undefined || (before !== null && same(value, before[column]))) continue;
    if (deciding.has(column) && keptCopy(column) !== undefined) {
      // A new row's is thrown away by the copy. A stored row's would stay (a copy runs again only when its link moves),
      // and the row would say a parent's owner the parent does not have: not a limited writer's to write.
      if (before !== null && reaches !== null) refuse(column, 'kept-by-copy');
      continue;
    }
    if (deciding.has(column) && !(await holdsItself())) refuse(column, 'not-theirs-to-give');
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
      // Nobody's: a row a limited writer could then not see, unless their reach includes those (or, for a stored row, every
      // row it is: a reach of every won deal empties the owner of a won deal, not of an open one held another way).
      if (reaches !== null && !reaches.some((reach) => reach.unowned === true || (reach.reach === 'all' && before === null)) && !(before !== null && reachesWhole(before))) refuse(column, 'staff-column');
      continue;
    }
    if (!viaPerson) {
      const user = typeof named === 'string' ? await usersRepo(meta).findById(named) : null;
      if (user === null || user.status === 'suspended') throw new ValidationFailedError('Some values were refused.', { fields: { [column]: { code: 'not-found' } } });
      // Listed against rows of other tables: somebody who reads at least one of them.
      const opened = opts.connectionId === undefined ? [] : readThrough(model, table.id, column);
      if (opened.length > 0) {
        const theirs = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id });
        if (!opened.some((other) => permissionSetAllows(theirs, `table:${opts.connectionId!}:${other.id}:read`))) {
          throw new ValidationFailedError('Some values were refused.', { fields: { [column]: { code: 'cannot-open' } } });
        }
      }
      /*
       * A ROW HANDED OVER GOES TO SOMEBODY WHO CAN WORK IT. Not to a person
       * who has not arrived or is a sample; not to one whose roles do not
       * read AND change this table; not to one whose reach of it waits for a
       * state the row is not in (an account manager reads a deal once it is
       * won: an open deal given to her would answer to nobody but an admin).
       * Handing over everything a person holds refuses the same. So does a
       * limited writer naming anybody (`set: anyone`) in a column that
       * decides whose a row is by a plain write: the button is not the only
       * door to that column, and the row would answer to nobody either way.
       */
      const handing = opts.handOver === true || (reaches !== null && deciding.has(column) && rule.set === 'anyone');
      if (handing && opts.connectionId !== undefined) {
        const cannot = (): never => {
          throw new ValidationFailedError('Some values were refused.', { fields: { [column]: { code: 'cannot-open' } } });
        };
        if (user.status !== 'active') cannot();
        const theirs = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id });
        const next: Row = { ...(before ?? {}), ...values };
        for (const action of ['read', 'update'] as const) {
          if (!permissionSetAllows(theirs, `table:${opts.connectionId}:${table.id}:${action}`)) cannot();
          const held = rowReachesOf(theirs, opts.connectionId, table.id, action);
          if (held !== null && !held.some((one) => one.while === undefined || one.while.in.some((value) => String(value) === String(next[one.while!.column])))) cannot();
        }
      }
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
export async function assertNoUnreachedChildren(
  ctx: RowLimitContext | null,
  db: Db,
  tableId: string,
  row: Row,
  /**
   * The outbox links that let go of this table's rows (`outbox/release.ts`):
   * the app's own messages about the row, which the app said never hold it.
   * Whether any is there, the delete answers the same, so nothing is counted
   * for the person either way.
   */
  released: readonly { outbox: string; link: string }[] = [],
): Promise<void> {
  if (ctx === null) return;
  for (const relation of ctx.model.relations) {
    if (relation.through !== null || relation.to.tableId !== tableId || relation.from.columns.length !== 1 || relation.to.columns.length !== 1) continue;
    if (released.some((link) => link.outbox === relation.from.tableId && link.link === relation.from.columns[0])) continue;
    const test = rowLimitFor(ctx, relation.from.tableId, 'read');
    const value = row[relation.to.columns[0]!];
    if (test === null || empty(value)) continue;
    const name = nameOf(ctx, relation.from.tableId);
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
