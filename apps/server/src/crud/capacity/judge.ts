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
 * state too: an owner's change that moves what its rows count is judged for
 * each of them, as if they had moved.
 *
 * A guest cancelling a slot inside the venue's cancellation window is
 * refused whatever the need: the window reads only the stored row.
 */
import { sql, type RawBuilder } from 'kysely';

import { ConflictError, ValidationFailedError } from '../../errors.js';
import type { Row } from '../mask.js';
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
import { hasLimits, ownedRules, ownColumns, rulesFor, stateColumn, type OwnedRule, type Rule } from './rules.js';
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
}

async function needOf(
  rule: Rule,
  row: Row,
  before: Row | null,
  ownerAfter: Row | null,
  ownerBefore: Row | null,
  ctx: CountContext,
  naming: boolean,
): Promise<Need> {
  const mode = (m: CountMode): CountMode => (naming ? m : 'exact');
  const after = await countsNow(rule, row, ownerAfter, ctx, mode('after-naming'));
  if (!after.counts) return { need: 'none', grew: false };
  if (before === null) return { need: 'full', grew: true };
  const prior = await countsNow(rule, before, ownerBefore, ctx, mode('before-naming'));
  if (!prior.counts) return { need: 'count', grew: true };
  if (await moved(rule, before, row, ownerBefore, ownerAfter, ctx)) return { need: 'full', grew: true };
  if (amountOf(rule, row) > amountOf(rule, before)) return { need: 'count', grew: true };
  // Out of a hold, into a state that counts with no end: counted again, under the lock.
  if (inHold(rule, before, ownerBefore) && !inHold(rule, row, ownerAfter)) return { need: 'count', grew: false };
  return { need: 'none', grew: false };
}

/* ----------------------------------------------------------------- names */

/** The lock a rule's pool is held by, for a row as it stands; null when the row takes from no pool. */
async function nameOf(rule: Rule, target: Pick<WriteTarget, 'connectionId' | 'table'>, row: Row, zone: string, reads: Reads, peek: boolean): Promise<NamedLock | null> {
  const base = `${target.connectionId}|${target.table.id}|cap|`;
  if (rule.kind === 'slot') {
    const instant = readInstant(row[rule.rule.slot]);
    if (instant === null) return null;
    return { name: `${base}slot|${venueClock(instant, zone).day}`, busy: 'CAPACITY_BUSY' };
  }
  if (rule.kind === 'night') return { name: `${base}night`, busy: 'CAPACITY_BUSY' };
  const i = String(rule.index);
  if (rule.lockBy === null) return { name: `${base}p${i}|*`, busy: 'CAPACITY_BUSY' };
  let value = row[rule.lockBy];
  if ((value === null || value === undefined || peek) && rule.lockBy !== rule.viaColumn) {
    // A copy of the pool's row not resolved yet (or sent by the writer, whose
    // value the copy will replace): one look through the link it copies from.
    const copy = target.table.table.columns.find((column) => column.name === rule.lockBy)?.copy;
    if (copy !== undefined && copy.via === rule.viaColumn) value = (await reads.linked(rule.via, row[rule.viaColumn]))?.[copy.from];
  }
  return { name: `${base}p${i}|${value === null || value === undefined ? '' : String(value)}`, busy: 'CAPACITY_BUSY' };
}

/** The children of an owner row a change reaches, read through `db`. */
async function childrenOf(owned: OwnedRule, key: unknown, db: Db): Promise<Row[]> {
  if (key === null || key === undefined) return [];
  return (await db
    .selectFrom(owned.table.id)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(owned.via), '=', key))
    .execute()) as Row[];
}

/** The owner rules a change of `row` reaches: the watched columns it changes. */
function reached(target: WriteTarget, row: Row, before: Row): { owned: OwnedRule; column: string }[] {
  const out: { owned: OwnedRule; column: string }[] = [];
  const text = (value: unknown) => (value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value));
  for (const owned of ownedRules(target.view, target.table)) {
    const column = owned.watched.find((c) => has(row, c) && text(row[c]) !== text(before[c]));
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
  const add = (lock: NamedLock | null) => {
    if (lock !== null && !out.has(lock.name)) out.set(lock.name, lock);
  };
  for (const given of rows) {
    const { target } = given;
    const zone = zoneOf(target);
    const ctx: CountContext = { reads, now: new Date(), origin: 'staff', zone };
    const row = given.before === null ? given.row : { ...given.before, ...given.row };
    for (const rule of rulesFor(target.view, target.table)) {
      const ownerAfter = rule.owner === null ? null : await reads.linked(rule.owner, row[rule.owner.column]);
      const ownerBefore = rule.owner === null || given.before === null ? null : await reads.linked(rule.owner, given.before[rule.owner.column]);
      const { need } = await needOf(rule, row, given.before, ownerAfter, ownerBefore, ctx, true);
      if (need !== 'none') add(await nameOf(rule, target, row, zone, reads, !given.prepared));
    }
    if (given.before === null) continue;
    const key = pkColumn(target) === null ? undefined : given.before[pkColumn(target)!];
    for (const { owned } of reached(target, row, given.before)) {
      const child = { ...target, table: owned.table };
      for (const stored of await childrenOf(owned, key, db)) {
        const { need } = await needOf(owned.rule, stored, stored, row, given.before, ctx, true);
        if (need !== 'none') add(await nameOf(owned.rule, child, stored, zone, reads, false));
      }
    }
  }
  return [...out.values()];
}

/* ----------------------------------------------------------------- judge */

/** A row the judge counts: one it was handed, or a row of an owner it was handed. */
interface Subject {
  /** Its place in the rows handed (an owner's rows answer at the owner's). */
  index: number;
  target: WriteTarget;
  row: Row;
  before: Row | null;
  /** The owner as it will stand, and as it stood, when the owner's change is what is judged. */
  owner?: { after: Row; before: Row | null; column: string } | undefined;
}

interface Judged {
  subject: Subject;
  rule: Rule;
  need: CapacityNeed;
  grew: boolean;
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
    if (!counted.counts) return;
    for (const unit of await unitsOf(rule, row, owner, ctx)) {
      const found = out.get(poolId(rule, unit));
      if (found === undefined) continue;
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

  // The rows handed are where a read of them finds them: a tree's root, the row being changed.
  for (const given of rows) {
    const key = pkColumn(given.target);
    if (key !== null && given.pk !== null) reads.know(given.target.table, key, given.row);
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
    subjects.push({ index, target: given.target, row: given.before === null ? given.row : { ...given.before, ...given.row }, before: given.before });
    if (given.pk !== null) {
      listKey(given.target, given.pk);
      seen.add(keyText(given.target, given.pk));
    }
  });
  // An owner's change reaches its rows: each is judged with the owner as it was and as it will be.
  for (const [index, given] of rows.entries()) {
    if (given.before === null || given.pk === null) continue;
    const key = pkColumn(given.target);
    if (key === null) continue;
    const after = { ...given.before, ...given.row };
    for (const { owned, column } of reached(given.target, after, given.before)) {
      const child = { ...given.target, table: owned.table };
      for (const stored of await childrenOf(owned, given.before[key], db)) {
        const pk = Object.fromEntries(owned.table.primaryKey.map((k) => [k, stored[k]]));
        if (seen.has(keyText(child, pk))) continue;
        seen.add(keyText(child, pk));
        listKey(child, pk);
        subjects.push({ index, target: child, row: stored, before: stored, owner: { after, before: given.before, column } });
      }
    }
  }

  // Each subject against each rule of its table: what it needs.
  const judged: Judged[] = [];
  const held = heldNames(db);
  for (const subject of subjects) {
    const zone = zoneOf(subject.target);
    const ctx: CountContext = { reads, now, origin, zone };
    const rules = subject.owner === undefined ? rulesFor(subject.target.view, subject.target.table) : ownedRules(subject.target.view, rows[subject.index]!.target.table).filter((o) => o.table.id === subject.target.table.id).map((o) => o.rule);
    for (const rule of rules) {
      const ownerAfter = subject.owner?.after ?? (rule.owner === null ? null : await reads.linked(rule.owner, subject.row[rule.owner.column]));
      const ownerBefore =
        subject.owner?.before ?? (rule.owner === null || subject.before === null ? null : await reads.linked(rule.owner, subject.before[rule.owner.column]));
      // A guest cancelling inside the venue's window: refused, whatever the cancel needs.
      if (rule.kind === 'slot' && isPublic && subject.before !== null && subject.owner === undefined && rule.rule.cancelHours !== undefined) {
        if (conditionsHold(rule, subject.before, ownerBefore) && !conditionsHold(rule, subject.row, ownerAfter)) {
          const hours = await reads.number(rule.rule.cancelHours);
          const slot = readInstant(subject.before[rule.rule.slot]);
          if (hours !== null && slot !== null && slot.getTime() - ruleNow(opts.clock, db).getTime() < hours * 3_600_000) {
            const column = rule.conditions.find((c) => c.level === 'own')?.column ?? rule.rule.slot;
            throw new ConflictError('It is too late to cancel online.', 'CAPACITY_TOO_LATE', { column });
          }
        }
      }
      const { need, grew } = await needOf(rule, subject.row, subject.before, ownerAfter, ownerBefore, ctx, false);
      if (need !== 'none' && opts.mode === 'save') {
        const lock = await nameOf(rule, subject.target, subject.row, zone, reads, false);
        if (lock !== null && !held.has(lock.name)) throw new LockMoved(lock.name);
      }
      judged.push({ subject, rule, need, grew, ownerAfter, ownerBefore, units: need === 'none' ? [] : await unitsOf(rule, subject.row, ownerAfter, ctx) });
    }
  }

  // Placement: a new or moved place the venue must offer.
  for (const j of judged) {
    if (j.need === 'none') continue;
    const place: PlaceContext = { reads, now, public: isPublic, zone: zoneOf(j.subject.target) };
    let placement: Placement | null = null;
    if (j.need === 'full') {
      if (j.rule.kind === 'slot') placement = await placeSlot(j.rule, j.subject.row, place);
      else if (j.rule.kind === 'parent') placement = await placeParent(j.rule, j.subject.row, place);
      else placement = await placeNight(j.rule, j.subject.row, j.ownerAfter, place);
    }
    if (placement === null && 'column' in j.rule.amount && amountOf(j.rule, j.subject.row) <= 0) placement = { column: j.rule.amount.column, code: 'out-of-range' };
    if (placement !== null) throw placementRefusal(j.rule, j.subject.owner === undefined ? placement : { ...placement, column: j.subject.owner.column }, j.subject.index);
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
  const column = culprit.subject.owner?.column ?? poolColumn(rule);
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
export async function capacityState(db: Db, target: WriteTarget, ask: CapacityAsk, now: Date): Promise<PoolState[]> {
  if (!limited(target)) return [];
  const rule = rulesFor(target.view, target.table)[ask.rule];
  if (rule === undefined) return [];
  const zone = zoneOf(target);
  const reads = new Reads(db);
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
): Promise<PoolState[]> {
  const ctx: CountContext = { reads: new Reads(db), now, origin, zone: zoneOf(target) };
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
