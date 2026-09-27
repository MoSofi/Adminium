// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DECIDE — the values Adminium writes because of what a write DOES, decided
 * from the row as stored, after RESOLVE and before the hooks and CHECK.
 *
 * FILL knows the new values only; a rule that answers "what changed?" needs
 * the old ones too. So these run where the stored row is in hand, and what
 * they decide joins the write's own values: checked by CHECK, written in the
 * same statement, and reported to undo like anything the writer sent. A value
 * decided here and written later, in a statement of its own, would be left
 * out of the undo entry and put back by nobody.
 *
 * Three rules live here: stamps, the booking rule's cancellation window
 * below, and a code renewed when its row changes hands (`crud/code-renew.ts`).
 *
 * STAMPS (`column.stamp`): a value written when a row is created, when a
 * watched column changes to one of the rule's values, or when a column is
 * first filled — the time a patient checked in, who took a payment, the day
 * an invoice was issued and the day it falls due. A change is a change
 * against the STORED row, so re-sending a status the row already holds stamps
 * nothing again. A stamp wins over a value the writer sent. What it writes:
 *
 *  - `now`; `today`, the date on the venue's calendar;
 *  - `user-name` / `user-id` — never on a public write (a browser key is
 *    nobody); an automation stamps its rule's name;
 *  - `byOrigin`: one word for a public write, another for staff — or, with no
 *    staff word, whatever the staff writer chose;
 *  - `copy`: another column of the row as it stands at that moment;
 *  - `claim`: a column of the signed-in person's own row on a public write
 *    (their email, their name); on a staff write, the staff word or nothing;
 *  - `addDays`: a date so many days after another — worked out after every
 *    other stamp, so a due date follows the issue date the same write stamps.
 *
 * A fingerprint (`hashOf`) is not decided here: it is sealed after the hooks,
 * the formulas and the child rows (`crud/seal.ts`).
 *
 * The booking rule's cancellation window:
 *
 *  - a cancellation inside `cancel.hours` of the visit's (stored) start is
 *    LATE: in mode `flag` the flag column is set and the cancellation goes
 *    through, whoever writes; in mode `refuse` a guest is turned away and
 *    staff are not;
 *  - a guest may not MOVE a visit inside the window in either mode — they
 *    cancel online, and ring to move it. Staff are never refused.
 *
 * An update whose stored row is gone decides nothing here: it matches
 * nothing. Nor does a write that brings in HISTORY — an import, sample data,
 * an undo: those rows say what happened then, and a stamp of today's time or
 * today's person over them would be false.
 */
import type { Kysely } from 'kysely';
import type { Dialect, Relation } from '@adminium/engine';
import type { TablePrivileges } from '@adminium/engine/adapter';

import type { StampTrigger, TableBookingRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ConflictError, ValidationFailedError } from '../errors.js';
import { bookingCounts } from './booking-guard.js';
import { renewCodes } from './code-renew.js';
import { numberOf, slotInstant } from './capacity-guard.js';
import type { ColumnStamp, TableRules } from './column-rules.js';
import type { ResolvedTable } from './identifiers.js';
import { instantFor, renderNow } from './instants.js';
import { lateRuleFor, lateVerdict, lateWindow, refusedBy } from './late.js';
import { dayPlus, momentOf, momentSettings, momentVias, shifted, wallOn, type MomentContext } from './moments.js';
import { StateTooLate } from './state-conditions.js';
import { emptiedByUndo, keptByUndo, undoMoveOf } from './undo-moves.js';
import { dayOf } from './states.js';
import { venueClock } from './venue-time.js';
import { sameValue } from './write-values.js';
import type { Row } from './mask.js';
import type { WriteAction, WriteActor, WriteOrigin } from './write-context.js';

export interface DecideContext {
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  /** The table written, so a decided value is spelled the way its column keeps one. */
  table: ResolvedTable;
  origin: WriteOrigin;
  actor: WriteActor | null;
  now: Date;
  /** The venue's time zone: where "today" is. */
  zone?: string | undefined;
  /** The signed-in person's own row, on a public write made in a session. */
  claimed?: Row | null | undefined;
  /** The model's links, to follow a stamp's moment through a foreign key. */
  relations?: readonly Relation[] | undefined;
  /** What the connection's role may write: a renewed code it may not is refused by name. */
  rights?: TablePrivileges | null | undefined;
}

/** Writes that put back what already happened: nothing is decided over them. */
const HISTORY: ReadonlySet<WriteOrigin> = new Set(['import', 'undo']);

/** "Yes", as a column keeps it: `true` in a boolean column, `1` in a number column a database uses for one. */
function yes(table: ResolvedTable, column: string): true | 1 {
  const type = table.columns.get(column)?.logicalType;
  return type === 'integer' || type === 'bigint' || type === 'decimal' || type === 'float' ? 1 : true;
}

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);

/**
 * Whether a rule on this table needs the stored row before it can decide —
 * or work a formula out: a change of `qty` alone still needs the `rate`.
 */
export function needsStored(rules: TableRules | null): boolean {
  return (
    rules?.booking?.cancel !== undefined ||
    [...(rules?.stamps ?? []), ...(rules?.seals ?? [])].some((stamp) => stamp.on !== 'create') ||
    (rules?.formulas?.length ?? 0) > 0 ||
    // A price by the night reads the stay's other dates and its rate's link.
    rules?.perNight !== undefined ||
    // A move is judged on the row as it is, and a lock on what the write changes.
    rules?.states !== undefined ||
    (rules?.stateParents?.length ?? 0) > 0 ||
    (rules?.bounds ?? []).some((bound) => bound.notBefore !== undefined) ||
    // A column required while another holds a value is judged on the row as the write leaves it.
    (rules?.checks ?? []).some((check) => check.requiredWhen !== undefined) ||
    // A code renewed when the row changes hands: a change is judged against what is stored.
    (rules?.codes ?? []).some((code) => code.renew !== undefined)
  );
}

/**
 * The write's values with what Adminium decides added, or the same object
 * when it decides nothing. Throws the refusal a guest is given when a change
 * is too late to make online.
 */
export async function decideRow(
  rules: TableRules | null,
  action: WriteAction,
  values: Row,
  before: Row | null,
  context: DecideContext,
): Promise<Row> {
  if (rules === null || action === 'delete' || HISTORY.has(context.origin)) return values;
  if (action === 'update' && before === null) return values;
  let out = values;
  if (action === 'update' && rules.booking?.cancel !== undefined) out = await decideLate(rules.booking, out, before!, context);
  if (action === 'update' && (rules.states?.late?.length ?? 0) > 0) out = await decideStatesLate(rules, out, before!, context);
  // A move marked undo keeps the stamps of the state it returns to, and empties those marked clearOnBack of the one it leaves.
  const undo = action === 'update' ? undoMoveOf(rules.states, before, out) : null;
  const stamps = undo === null ? (rules.stamps ?? []) : (rules.stamps ?? []).filter((stamp) => !keptByUndo(stamp, rules.states!.column, undo));
  const worked = await momentStamps(stamps, action, out, before, context);
  const stamped = stampRow(stamps, action, out, before, context, worked);
  const emptied = undo === null ? [] : (rules.stamps ?? []).filter((stamp) => emptiedByUndo(stamp, rules.states!.column, undo));
  const moved = emptied.length === 0 ? stamped : { ...stamped, ...Object.fromEntries(emptied.map((stamp) => [stamp.column, null])) };
  // A code renewed by this change — judged last, so a column a stamp just set (the holder copied in on accept) sets it off too — in the same statement, so the old one stops at the commit.
  return renewCodes(rules.codes, action, moved, before, context);
}

// ─── moments, read before the write ───────────────────────────────────────

/** The rows a row's links point at, read as they are (DECIDE holds nothing), by the link column. */
async function linkedRows(vias: readonly string[], row: Row, context: DecideContext): Promise<Map<string, Row | null>> {
  const out = new Map<string, Row | null>();
  for (const via of vias) {
    const value = row[via];
    const relation = (context.relations ?? []).find(
      (r) => r.through === null && r.from.tableId === context.table.id && r.from.columns.length === 1 && r.from.columns[0] === via && r.to.columns.length === 1,
    );
    if (value === null || value === undefined || relation === undefined) {
      out.set(via, null);
      continue;
    }
    const found = (await context.db
      .selectFrom(relation.to.tableId)
      .selectAll()
      .where((eb) => eb(context.db.dynamic.ref(relation.to.columns[0]!), '=', value))
      .executeTakeFirst()) as Row | undefined;
    out.set(via, found ?? null);
  }
  return out;
}

/** A moment context over a row as DECIDE sees it: its links read as they are, its settings read once. */
async function momentsFor(row: Row, vias: readonly string[], context: DecideContext, settings = momentSettings(context.db)): Promise<MomentContext> {
  return { table: context.table, row, linked: await linkedRows(vias, row, context), zone: context.zone ?? 'UTC', settings, db: context.db };
}

/**
 * The values of the stamps worked out from a moment that fire on this write —
 * now plus minutes or hours, a deadline, a moment of the row or a linked row —
 * by column, spelled as the column keeps a time. Null when there is no moment
 * (a setting that cannot be read, an empty column): the stamp writes empty.
 */
async function momentStamps(stamps: readonly ColumnStamp[], action: WriteAction, values: Row, before: Row | null, context: DecideContext): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const firing = stamps.filter((stamp) => typeof stamp.set === 'object' && ('addMinutes' in stamp.set || 'deadline' in stamp.set || 'moment' in stamp.set) && stampFires(stamp, action, values, before));
  if (firing.length === 0) return out;
  const row = { ...(before ?? {}), ...values };
  const settings = momentSettings(context.db);
  const spell = (stamp: ColumnStamp, at: Date | null) => (at === null ? null : (renderNow({ logicalType: stamp.logicalType }, at) ?? instantFor(at)));
  for (const stamp of firing) {
    const set = stamp.set as Exclude<ColumnStamp['set'], string>;
    if ('addMinutes' in set) {
      const moments = await momentsFor(row, [], context, settings);
      const shift = set.addMinutes.minutes !== undefined ? { minutes: set.addMinutes.minutes } : { hours: set.addMinutes.hours! };
      out.set(stamp.column, spell(stamp, await shifted(context.now, shift, 1, moments)));
    } else if ('deadline' in set) {
      const deadline = set.deadline;
      const moments = await momentsFor(row, momentVias(deadline.notAfter), context, settings);
      const days = typeof deadline.days === 'number' ? deadline.days : Number(await settings(deadline.days));
      const time = typeof deadline.time === 'string' ? deadline.time : await settings(deadline.time);
      const first =
        Number.isFinite(days) && days >= 0 && typeof time === 'string'
          ? wallOn(dayPlus(venueClock(context.now, context.zone ?? 'UTC').day, Math.trunc(days)), time, context.zone ?? 'UTC')
          : null;
      const cap = deadline.notAfter === undefined ? null : await momentOf(deadline.notAfter, moments);
      const at = first === null ? cap : cap === null ? first : new Date(Math.min(first.getTime(), cap.getTime()));
      out.set(stamp.column, spell(stamp, at));
    } else if ('moment' in set) {
      const moments = await momentsFor(row, momentVias(set.moment), context, settings);
      out.set(stamp.column, spell(stamp, await momentOf(set.moment, moments)));
    }
  }
  return out;
}

/**
 * A table's own late moves (`states.late`): a move to `to` from one of
 * `from`, made inside `within` before the moment — read from the row AS
 * STORED and its links as they are, so a guest's later arrival typed in the
 * same change does not move the window. In mode `flag` the flag is set when
 * late and taken out of the writer's values when not (it is Adminium's); in
 * mode `refuse` a guest (or, with `refuse: everyone`, anyone) is turned away.
 * The statement judges it again under the locks (`crud/states.ts`).
 */
async function decideStatesLate(rules: TableRules, values: Row, before: Row, context: DecideContext): Promise<Row> {
  const states = rules.states!;
  if (!has(values, states.column)) return values;
  const from = before[states.column] === null || before[states.column] === undefined ? states.initial : String(before[states.column]);
  const to = values[states.column] === null || values[states.column] === undefined ? null : String(values[states.column]);
  if (to === null || to === from) return values;
  const rule = lateRuleFor(states, from, to);
  if (rule === undefined) return values;
  const verdict = await lateVerdict(rule, await momentsFor(before, momentVias(rule.moment), context), context.now);
  if (verdict.inside && refusedBy(rule, context.origin)) {
    throw new StateTooLate('It is too late to make this change.', { column: states.column, at: verdict.at?.toISOString() ?? null });
  }
  if (rule.mode !== 'flag' || rule.flag === undefined) return values;
  if (verdict.inside) return { ...values, [rule.flag]: yes(context.table, rule.flag) };
  if (!has(values, rule.flag)) return values;
  const out = { ...values };
  delete out[rule.flag];
  return out;
}

/** Every trigger of a stamp: one, or a list of up to three. */
function triggersOf(stamp: ColumnStamp): StampTrigger[] {
  return Array.isArray(stamp.on) ? stamp.on : [stamp.on];
}

const empty = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** Whether this write is the moment a stamp is for. */
export function stampFires(stamp: Pick<ColumnStamp, 'on'>, action: WriteAction, values: Row, before: Row | null): boolean {
  return triggersOf(stamp as ColumnStamp).some((trigger) => {
    if (trigger === 'create') return action === 'create';
    // Whenever one of the columns changes: a create sets them all.
    if ('columns' in trigger) return action === 'create' || trigger.columns.some((column) => has(values, column) && !sameValue(before?.[column], values[column]));
    const column = trigger.column;
    if (!has(values, column)) return false;
    // First filled: empty before (or a new row), a value now.
    if ('filled' in trigger) return !empty(values[column]) && (action === 'create' || empty(before?.[column]));
    if (!trigger.values.some((value) => sameValue(value, values[column]))) return false;
    // A create whose value is already one of them (a walk-in written as checked in) stamps too.
    return action === 'create' || !sameValue(before?.[column], values[column]);
  });
}

/** A date so many days after `day` (`YYYY-MM-DD`), on the calendar. */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** What a stamp writes for this writer, or undefined when it writes nothing. `row` is the row as it stands now. */
function stampValue(stamp: ColumnStamp, context: DecideContext, row: Row): unknown {
  const set = stamp.set;
  const guest = context.origin === 'public';
  const who = (field: 'user-name' | 'user-id') => (field === 'user-name' ? context.actor?.label : context.actor?.id) ?? undefined;
  /** What a stamp word means: the moment, the venue's date, the person (never a guest). */
  const word = (name: StampWord): unknown => {
    // A zone-less column keeps the server's wall clock, as a fill does; a text
    // one (a time SQLite was given as text) the instant.
    if (name === 'now') return renderNow({ logicalType: stamp.logicalType }, context.now) ?? instantFor(context.now);
    if (name === 'today') return venueClock(context.now, context.zone ?? 'UTC').day;
    return guest ? undefined : who(name);
  };
  if (typeof set === 'string') return word(set);
  if ('byOrigin' in set) {
    // A side's word that is itself a stamp word means what that stamp writes; any other is written as it is.
    const said = guest ? set.byOrigin.public : set.byOrigin.staff;
    return said !== undefined && isStampWord(said) ? word(said) : said;
  }
  if ('copy' in set) return row[set.copy] ?? null;
  if ('claim' in set) {
    if (guest) return context.claimed?.[set.claim] ?? undefined;
    return set.staff === undefined ? undefined : who(set.staff);
  }
  if ('addDays' in set) {
    const from = dayOf(row[set.addDays.date]);
    if (from === null) return null;
    const { days, map } = set.addDays;
    const count = typeof days === 'number' ? days : map !== undefined ? map[String(row[days])] : Number(row[days]);
    if (count === undefined || !Number.isFinite(count)) return undefined;
    // A number of days a calendar holds: a hundred years either way, never a date past the end of time.
    if (Math.abs(count) > MAX_DAYS) {
      throw new ValidationFailedError('Some values were refused.', {
        fields: { [typeof days === 'string' ? days : stamp.column]: { code: 'out-of-range' } },
        column: typeof days === 'string' ? days : stamp.column,
      });
    }
    return addDays(from, Math.trunc(count));
  }
  // A fingerprint is sealed later, over everything the write stored.
  return undefined;
}

/** The words a stamp writes by meaning rather than as text. */
type StampWord = 'now' | 'today' | 'user-name' | 'user-id';

const STAMP_WORDS: ReadonlySet<string> = new Set<StampWord>(['now', 'today', 'user-name', 'user-id']);

function isStampWord(value: string): value is StampWord {
  return STAMP_WORDS.has(value);
}

/** A hundred years of days: more is no date anyone keeps. */
const MAX_DAYS = 36_600;

/**
 * Whether a stamp writes something for this writer. It writes nothing when
 * the writer is nobody (a guest, for a person's name), when a guest's
 * session names no row (`claim`), or when staff have a word of their own to
 * say (`byOrigin` with no staff word).
 */
export function stampYields(stamp: Pick<ColumnStamp, 'set'>, origin: WriteOrigin, claimed: Row | null): boolean {
  const set = stamp.set;
  const guest = origin === 'public';
  if (typeof set === 'string') return set === 'now' || set === 'today' || !guest;
  if ('byOrigin' in set) {
    const said = guest ? set.byOrigin.public : set.byOrigin.staff;
    // A guest is nobody: their side's person word gives nothing.
    return said !== undefined && !(guest && (said === 'user-name' || said === 'user-id'));
  }
  if ('claim' in set) return guest ? claimed?.[set.claim] !== undefined && claimed?.[set.claim] !== null : set.staff !== undefined;
  return !('hashOf' in set);
}

/** Whether a stamp that fired and gave nothing leaves the writer's own value: only staff's own word (`byOrigin` with no staff word). */
function writerSays(stamp: ColumnStamp, origin: WriteOrigin): boolean {
  const set = stamp.set;
  return typeof set === 'object' && 'byOrigin' in set && set.byOrigin.staff === undefined && origin !== 'public';
}

function stampRow(stamps: readonly ColumnStamp[], action: WriteAction, values: Row, before: Row | null, context: DecideContext, worked: ReadonlyMap<string, unknown> = new Map()): Row {
  let out: Row | null = null;
  // Dates worked out from another go last: they read what the stamps before them wrote.
  const ordered = [...stamps.filter((stamp) => !isAddDays(stamp)), ...stamps.filter(isAddDays)];
  for (const stamp of ordered) {
    if (!stampFires(stamp, action, values, before)) continue;
    const value = worked.has(stamp.column) ? worked.get(stamp.column) : stampValue(stamp, context, { ...(before ?? {}), ...(out ?? values) });
    if (value === undefined) {
      // Fired, and gave nothing: what the writer sent there is not taken for it — unless it is staff's own word.
      if (has(out ?? values, stamp.column) && !writerSays(stamp, context.origin)) {
        out ??= { ...values };
        delete out[stamp.column];
      }
      continue;
    }
    out ??= { ...values };
    out[stamp.column] = value;
  }
  return out ?? values;
}

const isAddDays = (stamp: ColumnStamp) => typeof stamp.set === 'object' && 'addDays' in stamp.set;

async function decideLate(rule: TableBookingRule, values: Row, before: Row, context: DecideContext): Promise<Row> {
  const cancel = rule.cancel!;
  const held = slotInstant(before[rule.start]);
  if (held === null || !bookingCounts(rule, before)) return values;
  const hours = await numberOf(context.db, cancel.hours);
  if (hours === null || lateWindow({ moment: held, withinMs: hours * 3_600_000, now: context.now }) === 'outside') return values;
  const guest = context.origin === 'public';

  // Inside the window. A guest moving it is turned away, in either mode.
  const moved = has(values, rule.start) && slotInstant(values[rule.start])?.getTime() !== held.getTime();
  if (guest && moved) {
    throw new ConflictError('It is too late to change this online.', 'BOOKING_TOO_LATE', { column: rule.start });
  }

  const cancelling =
    has(values, cancel.when.column) && String(values[cancel.when.column]) === cancel.when.to && String(before[cancel.when.column]) !== cancel.when.to;
  if (!cancelling) return values;
  if (cancel.mode === 'refuse') {
    if (guest) throw new ConflictError('It is too late to cancel online.', 'BOOKING_TOO_LATE', { column: cancel.when.column });
    return values;
  }
  // `flag`: through, and marked late — a cancellation logged, never charged.
  return cancel.flag === undefined ? values : { ...values, [cancel.flag]: yes(context.table, cancel.flag) };
}
