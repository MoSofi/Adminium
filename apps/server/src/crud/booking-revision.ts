// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE REVISION OF A BOOKING'S CALENDAR ENTRY (`table.booking.calendar.revision`).
 *
 * A calendar keeps the entry with the highest SEQUENCE, so the number must rise
 * on every change a calendar has to hear of: the start, the length, the person,
 * or the booking starting or ceasing to take its time (a cancel). Only Adminium
 * writes it: whatever a writer or a file sends for it is dropped, and the raise
 * is one statement (`revision + 1`) in the write's own transaction, so two quick
 * moves can never carry the same number. An undo that puts a time back is a
 * change like any other: the number goes on rising.
 *
 * The raise is asked at the UPDATE every write goes through, and at a followed
 * copy's own statement (a length that follows its service). A capacity rule's
 * release of a kept row writes directly too, but a table cannot carry both a
 * capacity and a booking rule, so it never moves a booking.
 */
import { sql, type Kysely } from 'kysely';

import type { TableBookingRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { bookingCounts, touchesBooking } from './booking-guard.js';
import { slotInstant } from './capacity-guard.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';

type Rule = TableBookingRule | { plain: unknown };

/** The rule's revision column, when the booking has a calendar word. */
export function revisionColumn(rule: Rule | undefined): string | undefined {
  return rule === undefined || 'plain' in rule ? undefined : rule.calendar?.revision;
}

/** The values with the writer's own say on the revision gone, and a new row's first number. */
export function withRevision(rule: Rule | undefined, action: 'create' | 'update', values: Row): Row {
  const column = revisionColumn(rule);
  if (column === undefined) return values;
  const { [column]: _sent, ...rest } = values;
  return action === 'create' ? { ...rest, [column]: 0 } : rest;
}

const instant = (value: unknown): number | null => slotInstant(value)?.getTime() ?? null;

/** Whether a change from `before` to `after` is one a calendar must hear of. */
export function movesCalendar(rule: TableBookingRule, before: Row, after: Row): boolean {
  return (
    instant(before[rule.start]) !== instant(after[rule.start]) ||
    Number(before[rule.minutes]) !== Number(after[rule.minutes]) ||
    String(before[rule.resource] ?? '') !== String(after[rule.resource] ?? '') ||
    bookingCounts(rule, before) !== bookingCounts(rule, after)
  );
}

/**
 * The statement's values with the revision raised, when this write changes
 * what a calendar must hear of. Asked at the one UPDATE every write path goes
 * through, so no path can move a booking without it. The raise is the column
 * plus one in the statement itself, so two writers at once both count.
 */
export async function raisedRevision(tx: Kysely<SourceDatabase>, table: ResolvedTable, values: Row, match: Row, set: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rule = table.table?.booking;
  const column = revisionColumn(rule);
  if (rule === undefined || 'plain' in rule || column === undefined || !touchesBooking(rule, values)) return set;
  let read = tx.selectFrom(table.id).selectAll();
  for (const [key, value] of Object.entries(match)) read = read.where(tx.dynamic.ref(key), '=', value as never);
  const stored = (await read.executeTakeFirst()) as Row | undefined;
  if (stored === undefined || !movesCalendar(rule, stored, { ...stored, ...values })) return set;
  return { ...set, [column]: sql`coalesce(${sql.ref(column)}, 0) + 1` };
}
