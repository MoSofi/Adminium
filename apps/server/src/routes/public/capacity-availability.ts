// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /public/availability/:ref` FOR A LIMIT OF ANY KIND — the question the
 * entry answers, asked as its kind asks it, and nothing a guest may not see.
 *
 *  - slot: `date` [+ `party`] → each time, free, full or paused; `from` and
 *    `days` [+ `party`] → a strip of days.
 *  - parent: [`under`] [`date`] [`qty`] [`exclude`] → each row the limit is
 *    held on that the key may read through one of its plain public reads (a
 *    ticket type a guest sees), at most 200. A row readable only with a
 *    typed code is never listed without that code.
 *  - night: `from` and `to` [+ `guests`] [+ `earliest`] [+ `exclude`] →
 *    each pool (a room type) the key may read through a plain public read,
 *    and the earliest arrival with room.
 *
 * A parameter the kind does not take is refused (400), never ignored. What
 * is left is said only where the entry says, and only when it is low; a
 * page asking whether N are left may ask no more than one order may take.
 * `exclude` names a row of the asker's own (a booking being moved, the order
 * a checkout already holds): looked up through the session, it leaves that
 * row out of the count; an id outside the session is ignored, and the
 * answer is the same as without it.
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../../connections/manager.js';
import { fitsGuests, nightAnswer, parentAnswer, ruleOf, slotDayAnswer, slotStripAnswer, type ShowLeft } from '../../crud/capacity/availability.js';
import { ownRows } from '../../crud/capacity/availability.js';
import { rangeOf } from '../../crud/capacity/judge.js';
import type { Rule } from '../../crud/capacity/rules.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { runList } from '../../crud/list.js';
import type { Row } from '../../crud/mask.js';
import { venueClock } from '../../crud/venue-time.js';
import type { WriteTarget } from '../../crud/write-context.js';
import { combinePredicates } from '../../public-api/claim.js';
import type { RecordFilter } from '../../crud/filters.js';
import { mandatoryAt } from '../../public-api/relative-filters.js';
import type { CompiledResource } from '../../public-api/scope.js';
import { parentOf } from '../../public-api/visible-with.js';
import type { PublicAvailabilityQuery } from './schema.js';

export type CapacityAnswer = { ok: true; body: { data: unknown[]; earliest?: string | null } } | { ok: false; message: string };

export interface CapacityQuestion {
  query: PublicAvailabilityQuery;
  resource: CompiledResource;
  /** Every resource the key reaches, by ref: the plain reads that say which rows a guest may see. */
  byRef: ReadonlyMap<string, CompiledResource>;
  timezone: string;
  view: SnapshotView;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  target: WriteTarget;
  /** The key of a row of `table` this session reaches, by the id asked, or null. */
  own: (table: ResolvedTable, id: string) => Promise<string | null>;
  now: Date;
  /**
   * The rows a read readable only with a code unlocks, for the code the
   * guest sent (absent: no code, and such a read shows nothing).
   */
  unlocked?: ((reader: CompiledResource) => Promise<unknown[]>) | undefined;
  /** Whether the asker holds a session: a read kept for signed-in guests shows its rows to nobody else. */
  signedIn?: boolean | undefined;
}

const refused = (message: string): CapacityAnswer => ({ ok: false, message });

/**
 * Whether a question to a released slot limit uses a parameter it never
 * took. Its query was one strict object, and these were not in it: they were
 * refused (400), and still are.
 */
export function beyondReleasedSlot(query: PublicAvailabilityQuery): boolean {
  return (['to', 'guests', 'earliest', 'under', 'qty', 'code'] as const).some((name) => query[name] !== undefined);
}

/** The parameters each kind takes; any other present is refused. */
const TAKES: Record<Rule['kind'], ReadonlySet<keyof PublicAvailabilityQuery>> = {
  slot: new Set(['date', 'party', 'from', 'days']),
  parent: new Set(['under', 'date', 'qty', 'exclude', 'code']),
  night: new Set(['from', 'to', 'guests', 'earliest', 'exclude']),
};

export async function answerCapacity(q: CapacityQuestion): Promise<CapacityAnswer> {
  const rule = ruleOf(q.target, q.resource.capacityRule ?? 0);
  if (rule === undefined) return refused('This entry answers no limit.');
  const asked = (Object.keys(q.query) as (keyof PublicAvailabilityQuery)[]).filter((name) => q.query[name] !== undefined);
  if (asked.some((name) => !TAKES[rule.kind].has(name))) return refused(`Ask a ${rule.kind} limit only for ${[...TAKES[rule.kind]].join(', ')}.`);
  const showLeft: ShowLeft | undefined = q.resource.showLeft;
  const exclude = await excluded(q, rule);

  if (rule.kind === 'slot') {
    const party = q.query.party ?? 1;
    if (q.query.date !== undefined && q.query.from === undefined && q.query.days === undefined) {
      return { ok: true, body: { data: await slotDayAnswer(q.db, q.target, rule, q.query.date, party, q.now, exclude) } };
    }
    if (q.query.date === undefined && q.query.from !== undefined && q.query.days !== undefined) {
      return { ok: true, body: { data: await slotStripAnswer(q.db, q.target, rule, q.query.from, q.query.days, party, q.now, exclude) } };
    }
    return refused('Ask for one date, or a from date with a number of days.');
  }

  if (rule.kind === 'parent') {
    if (rule.via === null) return { ok: true, body: { data: [] } };
    const ids = await readableIds(q, rule.via.table, rule.via.key);
    const day = q.query.date ?? (rule.day === null ? undefined : venueClock(q.now, q.timezone).day);
    // How many a page may ask for is capped per row (one order's most, and what is shown): see `askCap`.
    const qty = q.query.qty ?? 1;
    return { ok: true, body: { data: await parentAnswer(q.db, q.target, rule, ids, { day, qty, now: q.now, exclude, showLeft }) } };
  }

  const { from, to } = q.query;
  if (from === undefined || to === undefined) return refused('Ask for a from date and a to date.');
  if (to <= from || rangeOf(from, to).length > 31) return refused('Ask for at most 31 nights, from before to.');
  if (rule.via === null) return { ok: true, body: { data: [] } };
  // The pools a guest may see: a room type no plain public read shows is never listed.
  const readable = await readableIds(q, rule.via.table, rule.via.key);
  const via = rule.via;
  const all =
    readable.length === 0
      ? []
      : ((await q.db
          .selectFrom(via.table.id)
          .selectAll()
          .where((eb) => eb(q.db.dynamic.ref(via.key), 'in', readable))
          .orderBy(q.db.dynamic.ref(via.key))
          .execute()) as Row[]).filter((row) => fitsGuests(rule, row, q.query.guests));
  const pools = all.map((row) => String(row[rule.via!.key]));
  const answer = await nightAnswer(q.db, q.target, rule, pools, { from, to, earliest: q.query.earliest, now: q.now, exclude, showLeft });
  return { ok: true, body: { data: answer.pools, ...(q.query.earliest === undefined ? {} : { earliest: answer.earliest }) } };
}

/** The asker's own rows, by the id they named: a row of the table, or of its owner (their held order); none outside the session. */
async function excluded(q: CapacityQuestion, rule: Rule): Promise<Row[]> {
  const id = q.query.exclude;
  if (id === undefined) return [];
  const mine = await q.own(q.table, id);
  if (mine !== null) return ownRows(q.db, rule, { table: 'own', id: mine });
  if (rule.owner !== null) {
    const owner = await q.own(rule.owner.table, id);
    if (owner !== null) return ownRows(q.db, rule, { table: 'owner', id: owner });
  }
  return [];
}

/**
 * The keys of the rows of `target` this key may read through a plain public
 * read of that table — no claim, no parent; one shown only with a code, for
 * the rows the guest's code unlocks — under the entry's `under` column when
 * asked, at most 200.
 */
/** How many parents one ask may name. */
export const MAX_PARENTS = 60;

async function readableIds(q: CapacityQuestion, target: ResolvedTable, key: string): Promise<string[]> {
  /*
   * One parent, or several in one ask (`under=12,15,19`): a page that lists
   * twenty shows read their tickets in twenty requests, and spent a fifth of
   * an address's read budget on one page load. The rows come back as one
   * list either way — each is a row of the limit, whichever parent it is
   * under — and still two hundred at most.
   */
  const parents = q.query.under === undefined ? [] : [...new Set(q.query.under.split(',').map((value) => value.trim()).filter((value) => value !== ''))].slice(0, MAX_PARENTS);
  const under: RecordFilter | null =
    q.resource.under === undefined || parents.length === 0
      ? null
      : parents.length === 1
        ? { column: q.resource.under, op: 'eq', value: parents[0]! }
        : { column: q.resource.under, op: 'in', value: parents };
  if (q.resource.under !== undefined && parents.length === 0) return [];
  return readableKeys(q, target, key, under);
}

/** What says which rows of a table a guest may see: the key's plain reads, and the database they are asked of. */
export type ReadableQuestion = Pick<CapacityQuestion, 'byRef' | 'timezone' | 'view' | 'db' | 'dialect' | 'now' | 'unlocked' | 'signedIn'>;

/**
 * The values of `key` in the rows of `target` a guest may see: what the
 * key's plain public reads of the table show (no claim, no parent), and the
 * rows the guest's code unlocks — only those `only` keeps, when it is
 * given; at most 200.
 */
export async function readableKeys(q: ReadableQuestion, target: ResolvedTable, key: string, only: RecordFilter | null): Promise<string[]> {
  const readers = [...q.byRef.values()].filter(
    // A read kept for signed-in guests is no plain public read: without a session its rows are not listed, nor answered about.
    (r) => r.table === target.id && r.kind === 'records' && r.actions.has('read') && r.claim === null && parentOf(r) === null && (r.sessionOnly !== true || q.signedIn === true),
  );
  const out = new Set<string>();
  for (const reader of readers) {
    let mandatory = combinePredicates(mandatoryAt(reader.where, target, q.timezone, q.now), only);
    // A read that shows its rows only with a code: counted only for the rows the guest's code unlocks.
    if (reader.unlockBy !== null && reader.unlockBy !== undefined) {
      const keys = q.unlocked === undefined ? [] : await q.unlocked(reader);
      if (keys.length === 0) continue;
      mandatory = combinePredicates(mandatory, { column: target.primaryKey[0]!, op: 'in', value: keys });
    }
    const result = await runList({
      db: q.db,
      view: q.view,
      table: target,
      params: { limit: 200, count: 'none' },
      canReadPii: false,
      dialect: q.dialect,
      ...(mandatory === null ? {} : { mandatory }),
      exposeColumns: [key],
    });
    for (const row of result.data) if (row[key] !== null && row[key] !== undefined) out.add(String(row[key]));
    if (out.size >= 200) break;
  }
  return [...out].slice(0, 200);
}
