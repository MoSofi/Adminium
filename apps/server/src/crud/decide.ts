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
 * Two rules live here.
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
import type { Dialect } from '@adminium/engine';

import type { StampTrigger, TableBookingRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ConflictError } from '../errors.js';
import { bookingCounts } from './booking-guard.js';
import { numberOf, slotInstant } from './capacity-guard.js';
import type { ColumnStamp, TableRules } from './column-rules.js';
import type { ResolvedTable } from './identifiers.js';
import { instantFor, renderNow } from './instants.js';
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
    // A move is judged on the row as it is, and a lock on what the write changes.
    rules?.states !== undefined ||
    (rules?.stateParents?.length ?? 0) > 0 ||
    (rules?.bounds ?? []).some((bound) => bound.notBefore !== undefined)
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
  return stampRow(rules.stamps ?? [], action, out, before, context);
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
  if (typeof set === 'string') {
    // A zone-less column keeps the server's wall clock, as a fill does; a text
    // one (a time SQLite was given as text) the instant.
    if (set === 'now') return renderNow({ logicalType: stamp.logicalType }, context.dialect, context.now) ?? instantFor(context.dialect, context.now);
    if (set === 'today') return venueClock(context.now, context.zone ?? 'UTC').day;
    return guest ? undefined : who(set);
  }
  if ('byOrigin' in set) return guest ? set.byOrigin.public : set.byOrigin.staff;
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
    return count === undefined || !Number.isFinite(count) ? undefined : addDays(from, count);
  }
  // A fingerprint is sealed later, over everything the write stored.
  return undefined;
}

function stampRow(stamps: readonly ColumnStamp[], action: WriteAction, values: Row, before: Row | null, context: DecideContext): Row {
  let out: Row | null = null;
  // Dates worked out from another go last: they read what the stamps before them wrote.
  const ordered = [...stamps.filter((stamp) => !isAddDays(stamp)), ...stamps.filter(isAddDays)];
  for (const stamp of ordered) {
    if (!stampFires(stamp, action, values, before)) continue;
    const value = stampValue(stamp, context, { ...(before ?? {}), ...(out ?? values) });
    if (value === undefined) continue;
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
  if (hours === null || held.getTime() - context.now.getTime() >= hours * 3_600_000) return values;
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
