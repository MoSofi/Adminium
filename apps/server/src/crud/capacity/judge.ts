// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIMIT GUARD — naming a write's locks, and judging its rows under them.
 *
 *  1. Before any transaction opens, {@link capacityLockNames} names every
 *     pool the write's rows may take from (reading, without a lock, what a
 *     name depends on and the row does not say yet).
 *  2. The write takes those names, with its numbers' series, in one
 *     `withNamedLocks` call, then reads its clock.
 *  3. With the rows written (or about to be), {@link judgeCapacity} counts
 *     each pool once, leaving the listed rows out of what it reads and adding
 *     their own amounts, and refuses the first that does not fit. It names
 *     each row's locks again from the row as it now stands: a name not held
 *     means the row moved since step 1 (`LockMoved`), and the write starts
 *     over.
 *
 * {@link capacityState} answers the same counts with no lock and no write:
 * availability and staff counts.
 *
 * What a row asks of a rule (its NEED) is decided from the row before and
 * after the write:
 *
 *  - nothing, when it does not count after (a cancel, a hold that lapsed);
 *  - a count and its placement (`full`), when it is new or moves to another
 *    pool: the venue must offer the place, and the pool must have room;
 *  - a count only (`count`), when it takes more, when it counts again after
 *    it did not (a restored order is never refused by a later pause), or when
 *    it leaves a hold for a state that counts with no end — a confirm racing
 *    its hold's end must be counted under the pool's lock, or a buyer who
 *    took the lapsed places would be sold them twice.
 *
 * A row belonging to another (a ticket of an order) counts by its owner's
 * state too — and a row held until a moment read elsewhere (an order held
 * for a waitlist offer) by that row: a change that moves what those rows
 * count is judged for each of them, as if they had moved. The change reads
 * them held, and takes a lock per row it stands in for; a new row takes the
 * same lock for each row it points at. So an order moving to a sold-out day
 * and its first line written at that moment never pass each other unseen.
 *
 * A released app's slot rule asks of a change what it always asked (see
 * `legacyNeed`). Whatever a change asks, a row that counts after it takes
 * more than nothing: a party of none (or fewer) is refused, never counted as
 * places given back.
 *
 * A guest cancelling a slot inside the venue's cancellation window is
 * refused whatever the need: the window reads only the stored row.
 */
import { sql, type RawBuilder } from 'kysely';

import { ConflictError, ValidationFailedError } from '../../errors.js';
import type { Row } from '../mask.js';
import type { ResolvedTable } from '../identifiers.js';
import { readDay, readInstant } from '../moments.js';
import { venueClock } from '../venue-time.js';
import { ruleNow } from '../write-clock.js';
import type { WriteOrigin, WriteTarget } from '../write-context.js';
import {
  amountOf,
  at,
  conditionsHold,
  countsNow,
  envelopeDay,
  has,
  inHold,
  nightKey,
  poolRow,
  Reads,
  sizesOf,
  slotKey,
  staysOf,
  storedRows,
  unitsOf,
  addDays,
  type CountContext,
  type CountMode,
  type Db,
  type PoolAsk,
  type Unit,
} from './count.js';
import { heldNames, LockMoved, type NamedLock } from './locks.js';
import { placeNight, placeParent, placeSlot, slotDays, type PlaceContext, type Placement } from './placement.js';
import { hasLimits, linkColumns, ownedRules, ownColumns, rulesFor, stateColumn, type OwnedRule, type Rule } from './rules.js';
import {
  CAPACITY_REASONS,
  type CapacityAsk,
  type CapacityFullDetails,
  type CapacityJudgeOptions,
  type CapacityNeed,
  type JudgedRow,
  type LockNameRow,
  type PoolState,
} from './types.js';

export { hasLimits } from './rules.js';

/** Whether a table keeps a limit of any kind. */
const limited = (target: WriteTarget): boolean => hasLimits(target.table);

const zoneOf = (target: WriteTarget) => target.timezone ?? 'UTC';

/* ------------------------------------------------------------------ need */

/** Whether a write touches what the table's limits count, on its own rows or on rows that belong to them. */
export function touchesCapacity(target: Pick<WriteTarget, 'view' | 'table'>, values: Row): boolean {
  const written = (column: string) => has(values, column);
  if (rulesFor(target.view, target.table).some((rule) => ownColumns(rule).some(written))) return true;
  return ownedRules(target.view, target.table).some((owned) => owned.watched.some(written));
}

/** Whether a row's place in a rule's pool moved (another slot, show, day, stay or room type). */
async function moved(rule: Rule, before: Row, after: Row, ownerBefore: Row | null, ownerAfter: Row | null, ctx: CountContext): Promise<boolean> {
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  if (rule.kind === 'slot') {
    const a = readInstant(after[rule.rule.slot])?.getTime();
    const b = readInstant(before[rule.rule.slot])?.getTime();
    if (a !== b) return true;
    return rule.rule.resource !== undefined && text(after[rule.rule.resource]) !== text(before[rule.rule.resource]);
  }
  if (rule.kind === 'parent') {
    if (text(after[rule.viaColumn]) !== text(before[rule.viaColumn])) return true;
    if (rule.also.some((wider) => text(after[wider.column]) !== text(before[wider.column]))) return true;
    if (rule.perWrite !== null && text(after[rule.perWrite.within]) !== text(before[rule.perWrite.within])) return true;
    const units = async (row: Row, owner: Row | null) => (await unitsOf(rule, row, owner, ctx)).map((u) => `${u.part}|${u.key}|${u.at ?? ''}`).join(',');
    return (await units(after, ownerAfter)) !== (await units(before, ownerBefore));
  }
  const a = staysOf(rule, after, ownerAfter);
  const b = staysOf(rule, before, ownerBefore);
  if (a.from !== b.from || a.to !== b.to) return true;
  return (await nightKey(rule, after, ctx.reads)) !== (await nightKey(rule, before, ctx.reads));
}

interface Need {
  need: CapacityNeed;
  /** It takes more than it did. */
  grew: boolean;
  /** It counts after the write. */
  counts: boolean;
}

const NO_NEED: Need = { need: 'none', grew: false, counts: false };

/** A value as text, for telling whether a column changed. */
const textOf = (value: unknown) => (value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value));

/** The columns of `row` whose values differ from `before`: what a change sent, when the caller did not say. */
function changed(before: Row, row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([column, value]) => textOf(value) !== textOf(before[column])));
}

/**
 * What a change asks of a released slot rule, which it always asked of what
 * was sent: a slot sent (even unchanged) is placed again; a row counting
 * again, or an amount or resource sent, is counted. A step between two
 * counted states alone asks nothing — the one change it did not always ask
 * (a guest seated at a slot already over a lowered limit).
 */
function legacyNeed(rule: Extract<Rule, { kind: 'slot' }>, before: Row, sent: Row, ownerBefore: Row | null, naming: boolean): Need {
  if (naming) return { need: 'count', grew: true, counts: true };
  if (has(sent, rule.rule.slot)) return { need: 'full', grew: true, counts: true };
  if (!conditionsHold(rule, before, ownerBefore)) return { need: 'count', grew: true, counts: true };
  const amount = 'column' in rule.amount ? rule.amount.column : null;
  if ((amount !== null && has(sent, amount)) || (rule.rule.resource !== undefined && has(sent, rule.rule.resource))) return { need: 'count', grew: false, counts: true };
  return { need: 'none', grew: false, counts: true };
}

async function needOf(
  rule: Rule,
  row: Row,
  before: Row | null,
  ownerAfter: Row | null,
  ownerBefore: Row | null,
  ctx: CountContext,
  naming: boolean,
  sent: Row | null = null,
  ctxBefore: CountContext = ctx,
): Promise<Need> {
  const mode = (m: CountMode): CountMode => (naming ? m : 'exact');
  const after = await countsNow(rule, row, ownerAfter, ctx, mode('after-naming'));
  if (!after.counts) return NO_NEED;
  if (before === null) return { need: 'full', grew: true, counts: true };
  if (rule.kind === 'slot' && rule.legacy) return legacyNeed(rule, before, sent ?? changed(before, row), ownerBefore, naming);
  const prior = await countsNow(rule, before, ownerBefore, ctxBefore, mode('before-naming'));
  if (!prior.counts) return { need: 'count', grew: true, counts: true };
  if (await moved(rule, before, row, ownerBefore, ownerAfter, ctx)) return { need: 'full', grew: true, counts: true };
  if (amountOf(rule, row) > amountOf(rule, before)) return { need: 'count', grew: true, counts: true };
  // Out of a hold, into a state that counts with no end: counted again, under the lock.
  if (inHold(rule, before, ownerBefore) && !inHold(rule, row, ownerAfter)) return { need: 'count', grew: false, counts: true };
  return { need: 'none', grew: false, counts: true };
}

/* ----------------------------------------------------------------- names */

/**
 * The locks a rule's pools are held by, for a row as it stands; none when the
 * row takes from no pool. A parent rule's lock follows `lockBy`; a wider pool
 * that `lockBy` does not follow (two types sharing a room, locked per type)
 * takes a lock of its own, or two writers of different types would both take
 * the room's last place.
 */
async function namesOf(rule: Rule, target: Pick<WriteTarget, 'connectionId' | 'table'>, row: Row, zone: string, reads: Reads, peek: boolean): Promise<NamedLock[]> {
  const base = `${target.connectionId}|${target.table.id}|cap|`;
  const lock = (name: string): NamedLock => ({ name: `${base}${name}`, busy: 'CAPACITY_BUSY' });
  if (rule.kind === 'slot') {
    const instant = readInstant(row[rule.rule.slot]);
    return instant === null ? [] : [lock(`slot|${venueClock(instant, zone).day}`)];
  }
  if (rule.kind === 'night') return [lock('night')];
  const i = String(rule.index);
  if (rule.lockBy === null) return [lock(`p${i}|*`)];
  const valueOf = async (column: string): Promise<unknown> => {
    let value = row[column];
    if ((value === null || value === undefined || peek) && column !== rule.viaColumn) {
      // A copy of the pool's row not resolved yet (or sent by the writer, whose
      // value the copy will replace): one look through the link it copies from.
      const copy = target.table.table.columns.find((c) => c.name === column)?.copy;
      if (copy !== undefined && copy.via === rule.viaColumn) value = (await reads.linked(rule.via, row[rule.viaColumn]))?.[copy.from];
    }
    return value;
  };
  const value = await valueOf(rule.lockBy);
  const out = [lock(`p${i}|${value === null || value === undefined ? '' : String(value)}`)];
  for (const wider of rule.also) {
    if (wider.column === rule.lockBy) continue;
    const key = await valueOf(wider.column);
    if (key !== null && key !== undefined && key !== '') out.push(lock(`p${i}|${wider.part}|${String(key)}`));
  }
  return out;
}

/**
 * The lock a row's link to another row is held by: a new row pointing at an
 * order (or at the offer its hold ends with) and a change of that order take
 * the same one, so the change sees the new row, or the new row the change.
 */
function linkLock(connectionId: string, child: ResolvedTable, column: string, key: unknown): NamedLock {
  return { name: `${connectionId}|${child.id}|cap|o|${column}|${String(key)}`, busy: 'CAPACITY_BUSY' };
}

/** The links of a new row that name a lock: those holding a value. */
function linkLocksOf(rule: Rule, target: Pick<WriteTarget, 'connectionId' | 'table'>, row: Row): { lock: NamedLock; table: ResolvedTable; key: unknown }[] {
  return linkColumns(rule)
    .filter(({ column }) => row[column] !== null && row[column] !== undefined && row[column] !== '')
    .map(({ column, table }) => ({ lock: linkLock(target.connectionId, target.table, column, row[column]), table, key: row[column] }));
}

/** The rows a change of a row reaches, read through `db`: the middle rows (a hold read through the owner) and the child rows — held as `lock` says, or read. */
async function reachedRows(owned: OwnedRule, key: unknown, db: Db, lock: 'no-key' | 'update' | null): Promise<{ middle: unknown[]; children: Row[] }> {
  if (key === null || key === undefined) return { middle: [], children: [] };
  let keys: unknown[] = [key];
  if (owned.through !== undefined) {
    const through = owned.through;
    keys = (
      (await db
        .selectFrom(through.table.id)
        .select(db.dynamic.ref(through.key) as never)
        .where((eb) => eb(db.dynamic.ref(through.column), '=', key))
        .execute()) as Row[]
    )
      .map((row) => row[through.key])
      .filter((k) => k !== null && k !== undefined);
    if (keys.length === 0) return { middle: [], children: [] };
  }
  let query = db
    .selectFrom(owned.table.id)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(owned.via), 'in', keys));
  // Held: a change of one of them waits for this write, and this write reads it as committed (on Postgres as a
  // write holds every row it keeps, FOR NO KEY UPDATE: the row being changed may be one of them).
  if (lock !== null) query = lock === 'no-key' ? query.forNoKeyUpdate() : query.forUpdate();
  return { middle: owned.through === undefined ? [] : keys, children: (await query.execute()) as Row[] };
}

/** The locks a change reaching a child table takes: one per row it stands in for (the order, or each order held for the offer). */
function reachLocks(connectionId: string, owned: OwnedRule, key: unknown, middle: readonly unknown[]): NamedLock[] {
  if (owned.through !== undefined) return middle.map((k) => linkLock(connectionId, owned.table, owned.via, k));
  return key === null || key === undefined ? [] : [linkLock(connectionId, owned.table, owned.via, key)];
}

/** The owned rules a change of `row` reaches: the watched columns it changes. */
function reached(target: WriteTarget, row: Row, before: Row): { owned: OwnedRule; column: string }[] {
  const out: { owned: OwnedRule; column: string }[] = [];
  for (const owned of ownedRules(target.view, target.table)) {
    const column = owned.watched.find((c) => has(row, c) && textOf(row[c]) !== textOf(before[c]));
    if (column !== undefined) out.push({ owned, column });
  }
  return out;
}

const pkColumn = (target: WriteTarget): string | null => (target.table.primaryKey.length === 1 ? target.table.primaryKey[0]! : null);

/**
 * The locks a write's rows need, named outside any transaction, reading
 * through `db` (the pool's handle) without a lock what a name depends on
 * and the row does not say yet.
 */
export async function capacityLockNames(db: Db, rows: readonly LockNameRow[]): Promise<NamedLock[]> {
  const out = new Map<string, NamedLock>();
  const reads = new Reads(db);
  const add = (locks: readonly NamedLock[]) => {
    for (const lock of locks) if (!out.has(lock.name)) out.set(lock.name, lock);
  };
  for (const given of rows) {
    const { target } = given;
    const zone = zoneOf(target);
    const ctx: CountContext = { reads, now: new Date(), origin: 'staff', zone };
    const row = given.before === null ? given.row : { ...given.before, ...given.row };
    for (const rule of rulesFor(target.view, target.table)) {
      // A new row's links: whatever it needs, a change of the row it points at must see it.
      if (given.before === null) add(linkLocksOf(rule, target, row).map((l) => l.lock));
      const ownerAfter = rule.owner === null ? null : await reads.linked(rule.owner, row[rule.owner.column]);
      const ownerBefore = rule.owner === null || given.before === null ? null : await reads.linked(rule.owner, given.before[rule.owner.column]);
      const { need } = await needOf(rule, row, given.before, ownerAfter, ownerBefore, ctx, true);
      if (need !== 'none') add(await namesOf(rule, target, row, zone, reads, !given.prepared));
    }
    if (given.before === null) continue;
    for (const { owned } of reached(target, row, given.before)) {
      const child = { ...target, table: owned.table };
      const key = given.before[owned.key];
      const { middle, children } = await reachedRows(owned, key, db, null);
      add(reachLocks(target.connectionId, owned, key, middle));
      for (const stored of children) {
        const ownerAfter = owned.reads === 'owner' ? row : owned.rule.owner === null ? null : await reads.linked(owned.rule.owner, stored[owned.rule.owner.column]);
        const ownerBefore = owned.reads === 'owner' ? given.before : ownerAfter;
        const { need } = await needOf(owned.rule, stored, stored, ownerAfter, ownerBefore, ctx, true);
        if (need !== 'none') add(await namesOf(owned.rule, child, stored, zone, reads, false));
      }
    }
  }
  return [...out.values()];
}

/* ----------------------------------------------------------------- judge */

/** A row the judge counts: one it was handed, or a row a handed row's change reaches. */
interface Subject {
  /** Its place in the rows handed (a reached row answers at the row whose change reached it). */
  index: number;
  target: WriteTarget;
  row: Row;
  before: Row | null;
  /** What the writer sent, on a change of a handed row. */
  sent: Row | null;
  /** A reached row: the rule reaching it, the changed column it answers on, and the reaching row as it was and will be. */
  reach?:
    | {
        rule: Rule;
        column: string;
        /** The reaching row is the child's owner. */
        owner?: { after: Row; before: Row | null } | undefined;
        /** The reaching row is where the child's hold ends: counted before the change as it stood. */
        before?: Reads | undefined;
      }
    | undefined;
}

interface Judged {
  subject: Subject;
  rule: Rule;
  need: CapacityNeed;
  grew: boolean;
  /** It counts after the write. */
  counts: boolean;
  ownerAfter: Row | null;
  ownerBefore: Row | null;
  units: Unit[];
}

const poolId = (rule: Rule, ask: PoolAsk) => `${rule.table.id}\u0000${String(rule.index)}\u0000${ask.part}\u0000${ask.key}\u0000${ask.at ?? ''}`;

/** A 422 for a place the venue does not offer. A released slot rule's carries no reason, as it never did. */
function placementRefusal(rule: Rule, placement: Placement, index: number): ValidationFailedError {
  const fields = { [placement.column]: { code: placement.code } };
  if (rule.kind === 'slot' && rule.legacy) return new ValidationFailedError('Some values were refused.', { fields });
  return new ValidationFailedError('Some values were refused.', { fields, reason: CAPACITY_REASONS[placement.code], row: index });
}

/** The column a pool's refusal names. */
function poolColumn(rule: Rule): string {
  if (rule.kind === 'slot') return rule.rule.slot;
  return rule.viaColumn;
}

interface Tally {
  rule: Rule;
  ask: PoolAsk;
  taken: number;
  held: number;
  kept: number;
  /** Taken by rows this write does not change the count of. */
  others: number;
  size: number | null;
}

/**
 * Count the pools asked, from the rows stored (leaving out `exclude`) and
 * the rows `mine` holds in memory: per pool, what it holds.
 */
async function tally(
  rule: Rule,
  asks: readonly PoolAsk[],
  ctx: CountContext,
  exclude: readonly Row[],
  mine: readonly { row: Row; owner: Row | null; counted: boolean }[],
): Promise<Map<string, Tally>> {
  const out = new Map<string, Tally>();
  if (asks.length === 0) return out;
  for (const ask of asks) {
    const id = poolId(rule, ask);
    if (!out.has(id)) out.set(id, { rule, ask, taken: 0, held: 0, kept: 0, others: 0, size: null });
  }
  const where: RawBuilder<unknown>[] = [];
  const keysOf = (part: string) => [...new Set(asks.filter((a) => a.part === part).map((a) => a.key))];
  const days = [...new Set(asks.map((a) => a.at).filter((d): d is string => d !== undefined))].sort();
  if (rule.kind === 'slot') {
    const instants = asks.map((a) => Date.parse(a.key.split('|')[0]!)).filter((n) => Number.isFinite(n));
    if (instants.length > 0) {
      const first = new Date(Math.min(...instants));
      const last = new Date(Math.max(...instants));
      where.push(sql`${at('own', rule.rule.slot)} >= ${envelopeDay(first, -1)}`, sql`${at('own', rule.rule.slot)} < ${envelopeDay(last, 2)}`);
    }
  } else if (rule.kind === 'parent') {
    const parts = [...new Set(asks.map((a) => a.part))];
    const alternatives = parts.map((part) => {
      const column = part === 'p' ? rule.viaColumn : rule.also.find((wider) => wider.part === part)!.column;
      return sql`${at('own', column)} in (${sql.join(keysOf(part))})`;
    });
    where.push(alternatives.length === 1 ? alternatives[0]! : sql`(${sql.join(alternatives, sql` or `)})`);
    if (rule.day !== null && days.length > 0 && (rule.day.level === 'own' || rule.owner !== null)) {
      const column = at(rule.day.level, rule.day.column);
      where.push(sql`${column} >= ${addDays(days[0]!, -1)}`, sql`${column} < ${addDays(days.at(-1)!, 2)}`);
    }
  } else if (days.length > 0) {
    where.push(sql`${at(rule.from.level, rule.from.column)} < ${addDays(days.at(-1)!, 1)}`, sql`${at(rule.to.level, rule.to.column)} > ${days[0]!}`);
    if (rule.given === null) where.push(sql`${at('own', rule.viaColumn)} in (${sql.join(keysOf('n'))})`);
  }
  const add = async (row: Row, owner: Row | null, mineRow: boolean) => {
    const counted = await countsNow(rule, row, owner, ctx);
    if (!counted.counts && !counted.kept) return;
    for (const unit of await unitsOf(rule, row, owner, ctx)) {
      const found = out.get(poolId(rule, unit));
      if (found === undefined) continue;
      if (!counted.counts) {
        found.kept += unit.amount;
        continue;
      }
      found.taken += unit.amount;
      if (counted.held) found.held += unit.amount;
      if (counted.kept) found.kept += unit.amount;
      if (!mineRow) found.others += unit.amount;
    }
  };
  for (const stored of await storedRows(rule, ctx.reads.db, where, exclude, ctx.now)) await add(stored.row, stored.owner, false);
  for (const row of mine) {
    if (!row.counted) continue;
    await add(row.row, row.owner, true);
  }
  const tallies = [...out.values()];
  const sizes = await sizesOf(rule, tallies.map((t) => t.ask), ctx.reads);
  tallies.forEach((t, i) => (t.size = sizes[i] ?? null));
  return out;
}

function stateOf(t: Tally, fits: boolean): PoolState {
  return {
    table: t.rule.table.id,
    rule: t.rule.index,
    kind: t.rule.kind,
    key: t.rule.kind === 'slot' ? t.ask.key.split('|')[0]! : t.ask.key,
    ...(t.ask.at === undefined ? {} : { at: t.ask.at }),
    size: t.size,
    taken: t.taken,
    held: t.held,
    ...(t.rule.kept === null ? {} : { kept: t.kept }),
    left: t.size === null ? null : t.size - t.taken,
    fits,
  };
}

/**
 * Judge the rows of one write under its locks, through the transaction's
 * handle. Throws the first refusal (409 `CAPACITY_FULL`, `CAPACITY_TOO_LATE`,
 * or 422 with the field's code and `details.row`); answers every pool
 * counted.
 */
export async function judgeCapacity(db: Db, rows: readonly JudgedRow[], opts: CapacityJudgeOptions): Promise<PoolState[]> {
  const reaching = rows.some((row) => row.before !== null && ownedRules(row.target.view, row.target.table).length > 0);
  if (!rows.some((row) => limited(row.target)) && !reaching) return [];
  const now = opts.clock.locked(db);
  const reads = new Reads(db);
  const origin: WriteOrigin = opts.origin;
  const isPublic = origin === 'public';
  const held = heldNames(db);
  const requireHeld = (locks: readonly NamedLock[]) => {
    if (opts.mode !== 'save') return;
    for (const lock of locks) if (!held.has(lock.name)) throw new LockMoved(lock.name);
  };
  const merged = (given: JudgedRow) => (given.before === null ? given.row : { ...given.before, ...given.row });

  // The rows handed are where a read of them finds them: a tree's root, the row being changed.
  const created = new Set<string>();
  for (const given of rows) {
    const key = pkColumn(given.target);
    if (key === null || given.pk === null) continue;
    reads.know(given.target.table, key, merged(given));
    if (given.before === null) created.add(`${given.target.table.id}\u0000${String(given.pk[key])}`);
  }
  const listedKeys = new Map<string, Row[]>();
  const listKey = (target: WriteTarget, pk: Row) => {
    const list = listedKeys.get(target.table.id) ?? [];
    list.push(pk);
    listedKeys.set(target.table.id, list);
  };
  const seen = new Set<string>();
  const keyText = (target: WriteTarget, pk: Row) => `${target.table.id}\u0000${target.table.primaryKey.map((k) => String(pk[k])).join('\u0000')}`;

  const subjects: Subject[] = [];
  rows.forEach((given, index) => {
    subjects.push({ index, target: given.target, row: merged(given), before: given.before, sent: given.before === null ? null : (given.values ?? null) });
    if (given.pk !== null) {
      listKey(given.target, given.pk);
      seen.add(keyText(given.target, given.pk));
    }
  });
  // A change reaches the rows whose count reads it: each is judged with the changed row as it was and as it will be.
  const reachedSubjects = new Set<string>();
  for (const [index, given] of rows.entries()) {
    if (given.before === null || given.pk === null) continue;
    const after = merged(given);
    for (const { owned, column } of reached(given.target, after, given.before)) {
      const child = { ...given.target, table: owned.table };
      const key = given.before[owned.key];
      // Held by a save; a quote reads them as they are (it holds no row, and waits on no save).
      const { middle, children } = await reachedRows(owned, key, db, opts.mode !== 'save' || given.target.dialect === 'sqlite' ? null : given.target.dialect === 'postgres' ? 'no-key' : 'update');
      // A new row pointing here took this lock too: whichever came second sees the other.
      requireHeld(reachLocks(given.target.connectionId, owned, key, middle));
      let before: Reads | undefined;
      if (owned.reads === 'end') {
        reads.know(given.target.table, owned.key, after);
        before = new Reads(db);
        before.know(given.target.table, owned.key, given.before);
      }
      for (const stored of children) {
        const pk = Object.fromEntries(owned.table.primaryKey.map((k) => [k, stored[k]]));
        const id = keyText(child, pk);
        if (!seen.has(id)) {
          seen.add(id);
          listKey(child, pk);
        }
        if (reachedSubjects.has(`${id}\u0000${String(owned.rule.index)}`)) continue;
        reachedSubjects.add(`${id}\u0000${String(owned.rule.index)}`);
        const owner = owned.reads === 'owner' ? { after, before: given.before } : undefined;
        subjects.push({ index, target: child, row: stored, before: stored, sent: null, reach: { rule: owned.rule, column, owner, before } });
      }
    }
  }

  // Each subject against each rule of its table: what it needs.
  const judged: Judged[] = [];
  for (const subject of subjects) {
    const zone = zoneOf(subject.target);
    const ctx: CountContext = { reads, now, origin, zone };
    const ctxBefore: CountContext = subject.reach?.before === undefined ? ctx : { ...ctx, reads: subject.reach.before };
    const rules = subject.reach === undefined ? rulesFor(subject.target.view, subject.target.table) : [subject.reach.rule];
    for (const rule of rules) {
      const ownerAfter = subject.reach?.owner?.after ?? (rule.owner === null ? null : await reads.linked(rule.owner, subject.row[rule.owner.column]));
      const ownerBefore =
        subject.reach?.owner?.before ?? (rule.owner === null || subject.before === null ? null : await ctxBefore.reads.linked(rule.owner, subject.before[rule.owner.column]));
      // A new row's links: a change of the row it points at took (or will take) the same lock.
      if (subject.before === null && subject.reach === undefined) {
        requireHeld(linkLocksOf(rule, subject.target, subject.row).filter((l) => !created.has(`${l.table.id}\u0000${String(l.key)}`)).map((l) => l.lock));
      }
      // A guest cancelling inside the venue's window: refused, whatever the cancel needs.
      if (rule.kind === 'slot' && isPublic && subject.before !== null && subject.reach === undefined && rule.rule.cancelHours !== undefined) {
        if (conditionsHold(rule, subject.before, ownerBefore) && !conditionsHold(rule, subject.row, ownerAfter)) {
          const hours = await reads.number(rule.rule.cancelHours);
          const slot = readInstant(subject.before[rule.rule.slot]);
          if (hours !== null && slot !== null && slot.getTime() - ruleNow(opts.clock, db).getTime() < hours * 3_600_000) {
            const column = rule.conditions.find((c) => c.level === 'own')?.column ?? rule.rule.slot;
            throw new ConflictError('It is too late to cancel online.', 'CAPACITY_TOO_LATE', { column });
          }
        }
      }
      const { need, grew, counts } = await needOf(rule, subject.row, subject.before, ownerAfter, ownerBefore, ctx, false, subject.sent, ctxBefore);
      if (need !== 'none') requireHeld(await namesOf(rule, subject.target, subject.row, zone, reads, false));
      judged.push({ subject, rule, need, grew, counts, ownerAfter, ownerBefore, units: need === 'none' ? [] : await unitsOf(rule, subject.row, ownerAfter, ctx) });
    }
  }

  // Placement: a new or moved place the venue must offer; and a row that counts takes something.
  for (const j of judged) {
    if (!j.counts) continue;
    const own = j.subject.reach === undefined;
    const place: PlaceContext = { reads, now, public: isPublic, zone: zoneOf(j.subject.target) };
    let placement: Placement | null = null;
    if (j.need === 'full') {
      if (j.rule.kind === 'slot') placement = await placeSlot(j.rule, j.subject.row, place);
      else if (j.rule.kind === 'parent') placement = await placeParent(j.rule, j.subject.row, place);
      else placement = await placeNight(j.rule, j.subject.row, j.ownerAfter, place);
    }
    // A slot row that counts holds a slot: a released rule always refused one without (a restored row too).
    if (placement === null && own && j.rule.kind === 'slot' && (j.need !== 'none' || j.rule.legacy) && readInstant(j.subject.row[j.rule.rule.slot]) === null) {
      placement = { column: j.rule.rule.slot, code: 'out-of-range' };
    }
    // What a counted row takes is above zero, whatever else the change asks: a party of none (or fewer) never frees a place.
    if (placement === null && own && 'column' in j.rule.amount && amountOf(j.rule, j.subject.row) <= 0) placement = { column: j.rule.amount.column, code: 'out-of-range' };
    if (placement !== null) throw placementRefusal(j.rule, own ? placement : { ...placement, column: j.subject.reach!.column }, j.subject.index);
  }

  // "Up to six per order": the order's rows of one type, with this write's, within the rule's maximum.
  for (const j of judged) {
    if (j.rule.kind !== 'parent' || j.rule.perWrite === null || !(j.need === 'full' || j.grew)) continue;
    await perWrite(j, judged, listedKeys.get(j.rule.table.id) ?? [], { reads, now, origin, zone: zoneOf(j.subject.target) });
  }

  // Count each pool a needing row takes from, once, with every row this write holds in memory.
  const states: PoolState[] = [];
  const byRule = new Map<Rule, Judged[]>();
  for (const j of judged) byRule.set(j.rule, [...(byRule.get(j.rule) ?? []), j]);
  for (const [rule, list] of byRule) {
    const asks = new Map<string, PoolAsk>();
    for (const j of list) for (const unit of j.units) asks.set(poolId(rule, unit), { part: unit.part, key: unit.key, at: unit.at });
    if (asks.size === 0) continue;
    const zone = zoneOf(list[0]!.subject.target);
    const ctx: CountContext = { reads, now, origin, zone };
    const mine = list.map((j) => ({ row: j.subject.row, owner: j.ownerAfter, counted: true }));
    const counted = await tally(rule, [...asks.values()], ctx, listedKeys.get(rule.table.id) ?? [], mine);
    for (const t of counted.values()) {
      const fits = t.size === null || t.taken <= t.size;
      states.push(stateOf(t, fits));
      if (fits) continue;
      const culprit = list.find((j) => j.need !== 'none' && j.units.some((u) => poolId(rule, u) === poolId(rule, t.ask)))!;
      throw fullRefusal(rule, t, culprit);
    }
  }
  return states;
}

function fullRefusal(rule: Rule, t: Tally, culprit: Judged): ConflictError {
  const column = culprit.subject.reach?.column ?? poolColumn(rule);
  if (rule.kind === 'slot' && rule.legacy) return new ConflictError('That time is full.', 'CAPACITY_FULL', { column });
  const details: CapacityFullDetails = {
    column,
    rule: rule.index,
    kind: rule.kind,
    row: culprit.subject.index,
    pool: { key: rule.kind === 'slot' ? t.ask.key.split('|')[0] : t.ask.key, ...(t.ask.at === undefined ? {} : { at: t.ask.at }) },
    ...(t.size === null ? {} : { left: Math.max(0, t.size - t.others) }),
  };
  const message = rule.kind === 'slot' ? 'That time is full.' : rule.kind === 'parent' ? 'That is sold out.' : 'There is no room on those nights.';
  return new ConflictError(message, 'CAPACITY_FULL', details);
}

/** Refuse a row that would take its owner past the most one owner may take of one pool. */
async function perWrite(j: Judged, judged: readonly Judged[], exclude: readonly Row[], ctx: CountContext): Promise<void> {
  const rule = j.rule as Extract<Rule, { kind: 'parent' }>;
  const within = rule.perWrite!.within;
  const owner = j.subject.row[within];
  const key = j.subject.row[rule.viaColumn];
  if (owner === null || owner === undefined || key === null || key === undefined) return;
  const same = (row: Row) => String(row[within]) === String(owner) && String(row[rule.viaColumn]) === String(key);
  let total = 0;
  for (const other of judged) {
    if (other.rule !== rule || !same(other.subject.row)) continue;
    if ((await countsNow(rule, other.subject.row, other.ownerAfter, ctx)).counts) total += amountOf(rule, other.subject.row);
  }
  const stored = await storedRows(rule, ctx.reads.db, [sql`${at('own', within)} = ${owner}`, sql`${at('own', rule.viaColumn)} = ${key}`], exclude, ctx.now);
  for (const row of stored) if ((await countsNow(rule, row.row, row.owner, ctx)).counts) total += amountOf(rule, row.row);
  const units = await unitsOf(rule, j.subject.row, j.ownerAfter, ctx);
  const target = await poolRow(rule, 'p', String(key), ctx.reads);
  const max = (await sizesOfMax(rule, target, units[0]?.at, ctx)) ?? null;
  if (max !== null && total > max) {
    throw placementRefusal(rule, { column: rule.viaColumn, code: 'too-many' }, j.subject.index);
  }
}

async function sizesOfMax(rule: Extract<Rule, { kind: 'parent' }>, target: Row | null, day: string | undefined, ctx: CountContext): Promise<number | null> {
  const max = rule.perWrite!.max;
  if (max.kind === 'number') return max.value;
  if (max.kind === 'setting') return ctx.reads.number(max.setting);
  if (target === null || max.kind === 'hop') return null;
  if (max.onDay !== undefined && readDay(target[max.onDay]) !== day) return null;
  const n = Number(target[max.column]);
  return target[max.column] === null || target[max.column] === undefined || !Number.isFinite(n) ? null : n;
}

/* ----------------------------------------------------------------- state */

/**
 * A table's pools as they stand at `now`, counted without a lock or a write:
 * for each pool asked (`keys`, on `day` or each day/night of `from`..`to`).
 * A slot rule asked for days answers each slot of the day on the grid.
 */
export async function capacityState(db: Db, target: WriteTarget, ask: CapacityAsk, now: Date, reads: Reads = new Reads(db)): Promise<PoolState[]> {
  if (!limited(target)) return [];
  const rule = rulesFor(target.view, target.table)[ask.rule];
  if (rule === undefined) return [];
  const zone = zoneOf(target);
  const ctx: CountContext = { reads, now, origin: ask.origin === 'public' ? 'public' : 'staff', zone };
  const days = ask.day !== undefined ? [ask.day] : ask.from !== undefined && ask.to !== undefined ? rangeOf(ask.from, ask.to) : [];
  const asks: PoolAsk[] = [];
  if (rule.kind === 'slot') {
    for (const day of await slotDays(rule, reads, zone, days)) {
      for (const slot of day.slots) asks.push({ part: 's', key: slotKey(slot.instant, null), at: day.day });
    }
  } else if (rule.kind === 'parent') {
    for (const key of ask.keys ?? []) {
      if (rule.day === null) asks.push({ part: 'p', key, at: undefined });
      else for (const day of days) asks.push({ part: 'p', key, at: day });
    }
  } else {
    for (const key of ask.keys ?? []) for (const night of days) asks.push({ part: 'n', key, at: night });
  }
  const counted = await tally(rule, asks, ctx, ask.exclude ?? [], []);
  return [...counted.values()].map((t) => stateOf(t, t.size === null || t.taken <= t.size));
}

/** Pools of a rule asked by hand (a wider pool's keys), counted without a lock or a write. */
export async function tallyFor(
  db: Db,
  target: WriteTarget,
  rule: Rule,
  asks: readonly PoolAsk[],
  now: Date,
  exclude: readonly Row[],
  origin: 'public' | 'staff',
  reads: Reads = new Reads(db),
): Promise<PoolState[]> {
  const ctx: CountContext = { reads, now, origin, zone: zoneOf(target) };
  const counted = await tally(rule, asks, ctx, exclude, []);
  return [...counted.values()].map((t) => stateOf(t, t.size === null || t.taken <= t.size));
}

/** The days `from` (inclusive) to `to` (exclusive). */
export function rangeOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The pools of a parent rule's wider pool a pool row takes from: the row's copy of the wider key, when the table copies it. */
export async function widerKeysOf(target: WriteTarget, rule: Extract<Rule, { kind: 'parent' }>, keys: readonly string[], reads: Reads): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  if (rule.via !== null) await reads.load(rule.via.table, rule.via.key, keys);
  for (const wider of rule.also) {
    const copy = target.table.table.columns.find((column) => column.name === wider.column)?.copy;
    if (copy === undefined || copy.via !== rule.viaColumn) continue;
    const per = new Map<string, string>();
    for (const key of keys) {
      const row = await reads.linked(rule.via, key);
      const value = row?.[copy.from];
      if (value !== null && value !== undefined) per.set(key, String(value));
    }
    out.set(wider.part, per);
  }
  return out;
}

export { stateColumn };
