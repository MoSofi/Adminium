// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STAFF COLUMN READ AS A NAME, and days counted by the server's clock.
 *
 * A staff column holds a person's id. Shown to a reader it is that person's
 * name, on ONE rule, the people list's own (`GET /people`):
 *
 *  - a name is answered to a signed-in person, never to an API key (a key is
 *    nobody and is told who nobody is);
 *  - a person is named when the people list would name them: here already
 *    (active), or the sample's. Somebody suspended, only invited or removed
 *    is not named, and neither is an id that is nobody's.
 *
 * The ids looked up are only ever the ids in rows the reader was answered
 * (their own read, their own row limit, their own columns), so a name is
 * never the way a row is learnt of. A group of a chart whose person is not
 * named is called "Unnamed person", in the reader's language: never the id.
 *
 * `daysSince` is "days in the stage": whole days from a date or time column
 * to today on the venue's calendar. The server works it out, so a browser
 * whose clock is a year off draws the same card.
 */
import type { Dialect } from '@adminium/engine';
import type { QueryDescriptor } from '@adminium/engine/config';
import type { MetaDb } from '@adminium/meta';

import type { ResolvedTable } from '../crud/identifiers.js';
import { staffInstants } from '../crud/instants.js';
import type { Row } from '../crud/mask.js';
import { venueClock } from '../crud/venue-time.js';
import { ValidationFailedError } from '../errors.js';

/** The people the people list names. */
const NAMED_STATUSES = ['active', 'sample'] as const;
/** Ids named per answer: a list stops at 1,000 rows and a chart at fewer groups. */
const NAMES_MAX = 2000;
const IN_PART = 200;

/** Whether `name` is a staff column of `table` that this reader's roles show. */
export function isStaffColumn(table: ResolvedTable, name: string | undefined): boolean {
  if (name === undefined) return false;
  const column = table.table?.columns.find((candidate) => candidate.name === name) as { staff?: boolean } | undefined;
  const read = table.columns.get(name) as { unreadable?: boolean; secret?: boolean } | undefined;
  return column?.staff === true && read !== undefined && read.unreadable !== true && read.secret !== true;
}

/** The name each of `ids` goes by, for those the people list names. */
export async function peopleNames(meta: MetaDb, ids: readonly unknown[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))].slice(0, NAMES_MAX);
  const out = new Map<string, string>();
  for (let at = 0; at < wanted.length; at += IN_PART) {
    const found = await meta.db
      .selectFrom('adminium_users')
      .select(['id', 'name'])
      .where('id', 'in', wanted.slice(at, at + IN_PART))
      .where('status', 'in', [...NAMED_STATUSES])
      .execute();
    for (const user of found) if (user.name !== '') out.set(user.id, user.name);
  }
  return out;
}

/**
 * What a chart calls each group keyed by a staff column: the person's name,
 * or `unnamed` for anybody the rule does not name. Every key is given a
 * label here, so none is left to read as its id.
 */
export async function staffGroupLabels(input: { meta: MetaDb; keys: readonly unknown[]; named: boolean; unnamed: string }): Promise<Map<string, string>> {
  const keys = [...new Set(input.keys.filter((key) => key !== null && key !== undefined).map(String))];
  const names = input.named ? await peopleNames(input.meta, keys) : new Map<string, string>();
  return new Map(keys.map((key) => [key, names.get(key) ?? input.unnamed]));
}

/** The staff columns a `record-list` asks the names of, checked: each a staff column of the table this reader is shown. */
export function peopleColumnsOf(descriptor: QueryDescriptor, table: ResolvedTable): string[] {
  const asked = descriptor.people ?? [];
  if (asked.length === 0) return [];
  if (descriptor.shape !== 'record-list') throw new ValidationFailedError('`people` names the staff columns of the rows of a "record-list".', { shape: descriptor.shape });
  for (const name of asked) {
    if (!isStaffColumn(table, name)) throw new ValidationFailedError(`"${name}" is not a staff column of ${table.id} that can be read as a name.`, { people: name });
  }
  return [...new Set(asked)];
}

export interface DaysSince {
  alias: string;
  column: string;
  /** A day with no time: read as written. */
  dateOnly: boolean;
}

/** `daysSince` checked: each a date or time column this reader is shown, under a name no column has. */
export function daysSinceOf(descriptor: QueryDescriptor, table: ResolvedTable): DaysSince[] {
  const asked = descriptor.daysSince ?? [];
  if (asked.length === 0) return [];
  if (descriptor.shape !== 'record-list') throw new ValidationFailedError('`daysSince` counts days on the rows of a "record-list".', { shape: descriptor.shape });
  const out: DaysSince[] = [];
  for (const entry of asked) {
    const at = entry.indexOf(':');
    const [alias, name] = [entry.slice(0, at), entry.slice(at + 1)];
    const column = table.columns.get(name) as { logicalType: string; unreadable?: boolean; secret?: boolean; masked?: boolean } | undefined;
    if (column === undefined || column.unreadable === true || column.secret === true || column.masked === true || !['date', 'timestamp', 'timestamptz'].includes(column.logicalType)) {
      throw new ValidationFailedError(`"${name}" is not a date or time column of ${table.id} days can be counted from.`, { daysSince: entry });
    }
    if (table.columns.has(alias) || out.some((other) => other.alias === alias)) throw new ValidationFailedError(`"${alias}" is taken: days are put under a name no column has.`, { daysSince: entry });
    out.push({ alias, column: name, dateOnly: column.logicalType === 'date' });
  }
  return out;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The venue's day a stored value falls on, or null for none. */
function dayOf(value: unknown, dateOnly: boolean, timezone: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (dateOnly) {
    // A driver hands a DATE back as text, or as that day's midnight on this server's clock.
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : `${String(value.getFullYear()).padStart(4, '0')}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    const text = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }
  const instant = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(instant.getTime()) ? null : venueClock(instant, timezone).day;
}

/** Each row with its days counted, under each alias. Rows are copied, never changed. */
export function withDaysSince(rows: readonly Row[], asked: readonly DaysSince[], opts: { table: ResolvedTable; dialect: Dialect; timezone: string; now: Date }): Row[] {
  if (asked.length === 0) return rows as Row[];
  const today = Date.parse(`${venueClock(opts.now, opts.timezone).day}T00:00:00Z`);
  return rows.map((row) => {
    // A SQLite source keeps a time as this server's wall clock: read as the instant it names, as the other two answer it.
    const read = staffInstants(row, opts.table, opts.dialect);
    const out: Row = { ...row };
    for (const one of asked) {
      const day = dayOf(read[one.column], one.dateOnly, opts.timezone);
      out[one.alias] = day === null ? null : Math.max(0, Math.round((today - Date.parse(`${day}T00:00:00Z`)) / 86_400_000));
    }
    return out;
  });
}
