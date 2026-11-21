// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `table.booking` — booking PEOPLE rather than tables: a row takes a resource
 * (a clinician) for its own length, and two counted rows of one resource may
 * never overlap.
 *
 * Beside `capacity`, not folded into it. Capacity adds up a party per start
 * time; booking forbids overlap per resource, within that resource's hours,
 * breaks and closures. They are different questions, and a table carries one
 * or the other.
 *
 * Every table the rule names is the app's own, by ref. With `prefixed`
 * install the server maps each of them — nested ones included — to the real
 * table name.
 */
import { z } from 'zod';

import {
  NUMERIC_TYPES,
  numberOrSetting,
  refSchema,
  settingRefSchema,
  valueFits,
  type ColumnShape,
  type ReferenceIssue,
  type TableIndex,
  type TableShape,
} from './refs.js';

/** The weekday values an hours table's weekday enum must hold, in this order. */
export const BOOKING_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const hoursColumns = {
  weekday: refSchema,
  opens: refSchema,
  closes: refSchema,
  breakStart: refSchema.optional(),
  breakEnd: refSchema.optional(),
};

/**
 * A table of times a person is away: part-day time off, or the busy times of
 * their calendar. A new time never touches one; a booking already there is
 * never moved or refused by one that arrives later. `engine`: the rows are
 * Adminium's own (a connected calendar's), replaced per `account`; the table
 * is `private`, and no person writes it.
 */
const busySourceSchema = z
  .object({
    table: refSchema,
    /** Whose time it is: a foreign key to the table the rule's resource points at. */
    resource: refSchema,
    /** Both ends are `timestamptz`; a row may run over several days. */
    start: refSchema,
    end: refSchema,
    countWhere: z.object({ column: refSchema, values: z.array(z.string().min(1)).min(1) }).strict().optional(),
    engine: z.object({ account: refSchema }).strict().optional(),
  })
  .strict();

/**
 * How "anyone" is given a person. `order` is the resources' own order; `even`
 * the one with the fewest counted rows that day, then the one whose last row
 * was made longest ago (`made`), then the order. `{column}` reads either word
 * from the kind's row. Without this word, `order`.
 */
const anyoneSchema = z
  .object({
    pick: z.union([z.enum(['order', 'even']), z.object({ column: refSchema }).strict()]),
    /** When a row was made: a `timestamptz` of this table. Needed by anything but `order`. */
    made: refSchema.optional(),
    /** A bool of this table Adminium sets: true when it picked the person, false once a write names one. */
    flag: refSchema.optional(),
  })
  .strict();

export const bookingSchema = z
  .object({
    /** When the row starts: a `timestamptz`, read in the venue's zone. */
    start: refSchema,
    /** How long it lasts: an int column on the row (copied from the kind). */
    minutes: refSchema,
    /**
     * Minutes kept clear after it: an int column on the row, copied always
     * from the kind. Two rows' times and buffers never overlap; the hours ask
     * only of `minutes`, so clean-up may run past closing or into a break.
     */
    buffer: refSchema.optional(),
    /** Whose time it takes: a foreign key. Empty on a create means "anyone" — Adminium picks. */
    resource: refSchema,
    /** What it is: a foreign key, which decides who may be booked for it. */
    kind: refSchema,
    /** Only rows whose column holds one of these take time (a cancelled visit takes none). */
    countWhere: z.object({ column: refSchema, values: z.array(z.string().min(1)).min(1) }).strict(),
    /** Who does what: a link table of (resource, kind), and the resources' own order and switches. */
    eligible: z
      .object({
        table: refSchema,
        resource: refSchema,
        kind: refSchema,
        order: z
          .object({
            table: refSchema,
            column: refSchema,
            /** A resource whose column is false is never booked. */
            active: refSchema.optional(),
            /** A resource whose column is false is never booked through the public API. */
            public: refSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    /**
     * Weekly hours as `HH:MM` text, one row per weekday. A resource with rows
     * of its own follows them; one without follows the practice's.
     */
    hours: z
      .object({
        practice: z.object({ table: refSchema, open: refSchema.optional(), ...hoursColumns }).strict(),
        own: z
          .object({
            table: refSchema,
            resource: refSchema,
            ...hoursColumns,
            /** `practice`: the practice's hours cap these (the later opening, the earlier closing; a day it is shut is shut). */
            within: z.literal('practice').optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    /** Dated closures, for everyone (resource empty) or one resource. */
    closures: z
      .object({
        table: refSchema,
        from: refSchema,
        to: refSchema,
        resource: refSchema.optional(),
        active: refSchema.optional(),
      })
      .strict()
      .optional(),
    /** Up to four tables of times a person is away (see {@link busySourceSchema}). */
    busy: z.array(busySourceSchema).min(1).max(4).optional(),
    /** How "anyone" is given a person (see {@link anyoneSchema}). */
    anyone: anyoneSchema.optional(),
    /** The minutes between bookable starts. */
    grid: numberOrSetting,
    /** How many working days ahead a booking may be made. */
    windowDays: numberOrSetting.optional(),
    /** Who the window holds: `guests` leaves staff free to book further ahead. Without this word, everyone. */
    windowFor: z.enum(['everyone', 'guests']).optional(),
    /** How far ahead a public booking must be. Staff are never held to it. */
    noticeMinutes: numberOrSetting.optional(),
    /**
     * A cancellation inside `hours` of the start. `refuse` turns a public
     * one away; `flag` lets it through and sets `flag`. Staff are never refused.
     */
    cancel: z
      .object({
        hours: numberOrSetting,
        mode: z.enum(['refuse', 'flag']),
        flag: refSchema.optional(),
        when: z.object({ column: refSchema, to: z.string().min(1) }).strict(),
      })
      .strict()
      .refine((c) => (c.mode === 'flag') === (c.flag !== undefined), {
        message: 'a flag names its column, and only mode "flag" has one',
        path: ['flag'],
      })
      .optional(),
  })
  .strict();
export type BookingRule = z.infer<typeof bookingSchema>;

/**
 * Everything in a table's booking rule that names something the manifest does
 * not declare, or a column of the wrong kind.
 */
export function bookingIssues(
  table: TableShape,
  rule: BookingRule,
  index: TableIndex,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const here = (...rest: (string | number)[]) => at('booking', ...rest);

  /** The column, when it exists and is one of `types`; an issue otherwise. */
  const want = (
    tableRef: string,
    column: string,
    types: readonly string[],
    path: (string | number)[],
    what: string,
  ): ColumnShape | undefined => {
    if (index.table(tableRef) === undefined) {
      out.push({ path, message: `"${tableRef}" is not a table of this app` });
      return undefined;
    }
    const found = index.column(tableRef, column);
    if (found === undefined) {
      out.push({ path, message: `"${tableRef}" has no column "${column}"` });
      return undefined;
    }
    if (!types.includes(found.type)) {
      out.push({ path, message: `"${tableRef}.${column}" must be ${what}` });
      return undefined;
    }
    return found;
  };
  /** A foreign key pointing at `target` (any target when omitted). */
  const wantFk = (tableRef: string, column: string, target: string | undefined, path: (string | number)[]) => {
    const found = want(tableRef, column, ['fk'], path, 'a foreign key');
    if (found !== undefined && target !== undefined && found.references !== target) {
      out.push({ path, message: `"${tableRef}.${column}" does not point at "${target}"` });
    }
    return found;
  };
  const setting = (value: unknown, path: (string | number)[]) => {
    const parsed = settingRefSchema.safeParse(value);
    if (parsed.success) want(parsed.data.table, parsed.data.column, NUMERIC_TYPES, path, 'a number');
  };

  want(table.ref, rule.start, ['timestamptz'], here('start'), 'a timestamptz');
  want(table.ref, rule.minutes, ['int', 'bigint'], here('minutes'), 'an int');
  if (rule.buffer !== undefined) {
    const buffer = want(table.ref, rule.buffer, ['int', 'bigint'], here('buffer'), 'an int');
    const copy = (buffer as { rules?: { copy?: { via?: string; mode?: string } } } | undefined)?.rules?.copy;
    if (buffer !== undefined && (copy?.via !== rule.kind || copy.mode !== 'always')) {
      out.push({ path: here('buffer'), message: `"${table.ref}.${rule.buffer}" is copied from the kind, always ("copy": { "via": "${rule.kind}", "mode": "always" }): free times read it there` });
    }
  }
  const resource = wantFk(table.ref, rule.resource, undefined, here('resource'));
  const kind = wantFk(table.ref, rule.kind, undefined, here('kind'));
  const resourceTable = resource?.references;
  const kindTable = kind?.references;

  const counted = index.column(table.ref, rule.countWhere.column);
  if (counted === undefined) {
    out.push({ path: here('countWhere', 'column'), message: `"${table.ref}" has no column "${rule.countWhere.column}"` });
  } else {
    for (const value of rule.countWhere.values) {
      if (!valueFits(counted, value)) {
        out.push({ path: here('countWhere', 'values'), message: `"${value}" is not a value of "${table.ref}.${counted.ref}"` });
      }
    }
  }

  const eligible = rule.eligible;
  wantFk(eligible.table, eligible.resource, resourceTable, here('eligible', 'resource'));
  wantFk(eligible.table, eligible.kind, kindTable, here('eligible', 'kind'));
  if (eligible.order !== undefined) {
    const order = eligible.order;
    if (resourceTable !== undefined && order.table !== resourceTable) {
      out.push({ path: here('eligible', 'order', 'table'), message: `the order is kept on "${resourceTable}", the table "${rule.resource}" points at` });
    }
    want(order.table, order.column, NUMERIC_TYPES, here('eligible', 'order', 'column'), 'a number');
    for (const name of ['active', 'public'] as const) {
      const column = order[name];
      if (column !== undefined) want(order.table, column, ['bool'], here('eligible', 'order', name), 'a bool');
    }
  }

  const weekday = (tableRef: string, column: string, path: (string | number)[]) => {
    const found = want(tableRef, column, ['enum'], path, `an enum of ${BOOKING_WEEKDAYS.join(', ')}`);
    if (found !== undefined && (found.enum ?? []).join(',') !== BOOKING_WEEKDAYS.join(',')) {
      out.push({ path, message: `"${tableRef}.${column}" must be an enum of ${BOOKING_WEEKDAYS.join(', ')}` });
    }
  };
  const times = (tableRef: string, hours: Record<string, string | undefined>, path: (string | number)[]) => {
    for (const name of ['opens', 'closes', 'breakStart', 'breakEnd']) {
      const column = hours[name];
      if (column !== undefined) want(tableRef, column, ['text'], [...path, name], 'a text column holding HH:MM');
    }
    if ((hours['breakStart'] === undefined) !== (hours['breakEnd'] === undefined)) {
      out.push({ path, message: 'a break names both its start and its end' });
    }
  };
  const practice = rule.hours.practice;
  weekday(practice.table, practice.weekday, here('hours', 'practice', 'weekday'));
  times(practice.table, practice, here('hours', 'practice'));
  if (practice.open !== undefined) want(practice.table, practice.open, ['bool'], here('hours', 'practice', 'open'), 'a bool');
  const own = rule.hours.own;
  if (own !== undefined) {
    wantFk(own.table, own.resource, resourceTable, here('hours', 'own', 'resource'));
    weekday(own.table, own.weekday, here('hours', 'own', 'weekday'));
    times(own.table, own, here('hours', 'own'));
  }

  const closures = rule.closures;
  if (closures !== undefined) {
    want(closures.table, closures.from, ['date'], here('closures', 'from'), 'a date');
    want(closures.table, closures.to, ['date'], here('closures', 'to'), 'a date');
    if (closures.resource !== undefined) {
      const column = wantFk(closures.table, closures.resource, resourceTable, here('closures', 'resource'));
      if (column !== undefined && column.nullable !== true) {
        out.push({ path: here('closures', 'resource'), message: `"${closures.table}.${closures.resource}" must be nullable: an empty one closes for everyone` });
      }
    }
    if (closures.active !== undefined) want(closures.table, closures.active, ['bool'], here('closures', 'active'), 'a bool');
  }

  const sources = rule.busy ?? [];
  sources.forEach((source, s) => {
    const path = (...rest: (string | number)[]) => here('busy', s, ...rest);
    if (source.table === table.ref) out.push({ path: path('table'), message: 'the rows of this table are already counted: a busy source is another table' });
    if (sources.findIndex((other) => other.table === source.table) !== s) out.push({ path: path('table'), message: `"${source.table}" is named twice` });
    wantFk(source.table, source.resource, resourceTable, path('resource'));
    want(source.table, source.start, ['timestamptz'], path('start'), 'a timestamptz');
    want(source.table, source.end, ['timestamptz'], path('end'), 'a timestamptz');
    if (source.countWhere !== undefined) {
      const column = index.column(source.table, source.countWhere.column);
      if (column === undefined) out.push({ path: path('countWhere', 'column'), message: `"${source.table}" has no column "${source.countWhere.column}"` });
      else for (const value of source.countWhere.values) if (!valueFits(column, value)) out.push({ path: path('countWhere', 'values'), message: `"${value}" is not a value of "${source.table}.${column.ref}"` });
    }
    if (source.engine !== undefined) {
      want(source.table, source.engine.account, ['text'], path('engine', 'account'), 'a text column');
      const held = index.table(source.table) as { private?: true } | undefined;
      if (held !== undefined && held.private !== true) out.push({ path: path('engine'), message: `"${source.table}" holds someone's calendar: it is "private": true` });
      if (sources.findIndex((other) => other.engine !== undefined) !== s) out.push({ path: path('engine'), message: 'one busy source is Adminium\'s own' });
    }
  });

  if (rule.anyone !== undefined) {
    const anyone = rule.anyone;
    if (anyone.pick !== 'order' && anyone.made === undefined) out.push({ path: here('anyone', 'made'), message: 'sharing evenly reads when each row was made: name that column' });
    if (anyone.made !== undefined) want(table.ref, anyone.made, ['timestamptz'], here('anyone', 'made'), 'a timestamptz');
    if (anyone.flag !== undefined) want(table.ref, anyone.flag, ['bool'], here('anyone', 'flag'), 'a bool');
    if (typeof anyone.pick === 'object' && kindTable !== undefined) {
      const column = want(kindTable, anyone.pick.column, ['enum'], here('anyone', 'pick', 'column'), 'an enum of even, order');
      if (column !== undefined && (column.enum ?? []).some((value) => value !== 'even' && value !== 'order')) {
        out.push({ path: here('anyone', 'pick', 'column'), message: `"${kindTable}.${column.ref}" must be an enum of even, order` });
      }
    }
  }

  setting(rule.grid, here('grid'));
  if (typeof rule.grid === 'number' && rule.grid === 0) out.push({ path: here('grid'), message: 'the grid is at least one minute' });
  setting(rule.windowDays, here('windowDays'));
  if (rule.windowFor !== undefined && rule.windowDays === undefined) out.push({ path: here('windowFor'), message: 'there is no window to say who it holds: name windowDays' });
  setting(rule.noticeMinutes, here('noticeMinutes'));

  if (rule.cancel !== undefined) {
    const cancel = rule.cancel;
    setting(cancel.hours, here('cancel', 'hours'));
    if (cancel.flag !== undefined) want(table.ref, cancel.flag, ['bool'], here('cancel', 'flag'), 'a bool');
    if (cancel.when.column !== rule.countWhere.column) {
      out.push({ path: here('cancel', 'when', 'column'), message: `a cancellation is a change of "${rule.countWhere.column}", the column that decides what counts` });
    } else if (counted !== undefined) {
      if (!valueFits(counted, cancel.when.to)) {
        out.push({ path: here('cancel', 'when', 'to'), message: `"${cancel.when.to}" is not a value of "${table.ref}.${counted.ref}"` });
      } else if (rule.countWhere.values.includes(cancel.when.to)) {
        out.push({ path: here('cancel', 'when', 'to'), message: `"${cancel.when.to}" still counts, so it frees no time` });
      }
    }
  }
  return out;
}
