// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHEN A MESSAGE IS DUE, AND WHEN IT IS NO LONGER WANTED.
 *
 * A producer that holds its messages gives each one a due moment: a number
 * of days after a date of the row it is about, at a time of day on the
 * venue's clock (09:00 unless it says). The days are fixed, one per value of
 * a column (the invoice's `ladder`), or read from a setting when the message
 * is made — and again whenever the scan re-dates it, so a moved due date, a
 * changed ladder or new ladder days move every message not yet sent.
 *
 * A due that cannot be worked out — no date yet, a ladder value nobody gave
 * days for, a setting that is not there — is left EMPTY: the message waits
 * for a person, is never "ready" and overtakes nothing. Nothing is sent on a
 * guess.
 *
 * `dropWhen` names the conditions under which a waiting message is no longer
 * needed (the invoice paid, voided); `supersede` ranks the messages of one
 * group, so a later one that has come due takes the place of the earlier
 * ones not yet sent.
 */
import type { Outbox, OutboxProducer, SettingSource } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { slotInstant } from '../crud/capacity-guard.js';
import { addOnSetting } from '../crud/write-stores.js';
import type { ResolvedColumn } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { venueClock, wallTimeToInstant } from '../crud/venue-time.js';
import { sameValue } from '../crud/write-values.js';

export type DueSpec = NonNullable<OutboxProducer['due']>;
export type DropCondition = NonNullable<OutboxProducer['dropWhen']>[number];
export type SkipReason = 'overtaken' | 'paid' | 'void' | 'no-longer-needed' | 'by-hand';

const DAY_MS = 86_400_000;
/** When a held message wakes, on the venue's clock, unless its producer says. */
export const DEFAULT_WAKE = '09:00';

/** Reads a setting's value; one pass keeps what it read. */
export type SettingReader = (source: SettingSource) => Promise<unknown>;

/**
 * A setting as stored: the app's own settings row (its first row), or an
 * add-on's settings in the meta store — the saved value, else the default the
 * add-on declares (the write path's own reader, `crud/write-stores.ts`). A list kept as JSON text (a SQLite
 * `json` column, a text column) is read as the list.
 */
export function settingReader(meta: MetaDb, db: Kysely<SourceDatabase>): SettingReader {
  const memo = new Map<string, Promise<unknown>>();
  return (source) => {
    const key = 'addOn' in source ? `addOn:${source.addOn}:${source.setting}` : `table:${source.table}:${source.column}`;
    let found = memo.get(key);
    if (found === undefined) {
      found = (async () => {
        // The saved value, else the add-on's declared default: a ladder nobody
        // has saved yet is the one the add-on ships, not "no days".
        if ('addOn' in source) return parsed(await addOnSetting(meta, source.addOn, source.setting));
        const row = (await db.selectFrom(source.table as never).select(source.column as never).limit(1).executeTakeFirst()) as Row | undefined;
        return parsed(row?.[source.column]);
      })();
      memo.set(key, found);
    }
    return found;
  };
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text.startsWith('[') && !text.startsWith('{')) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

/** A whole number of days, or null for anything else (an empty value is not zero). */
function wholeDays(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : null;
}

/** How many days after its date a message of this producer comes due, for this row. */
export async function daysFor(days: DueSpec['days'], row: Row, read: SettingReader): Promise<number | null> {
  if (typeof days === 'number') return days;
  if ('values' in days) {
    const pick = row[days.byColumn];
    return pick === null || pick === undefined ? null : wholeDays(days.values[String(pick)]);
  }
  let value = await read(days.setting);
  if (days.byColumn !== undefined) {
    const pick = row[days.byColumn];
    value = pick === null || pick === undefined || typeof value !== 'object' || value === null || Array.isArray(value) ? undefined : (value as Record<string, unknown>)[String(pick)];
  }
  if (days.index !== undefined) value = Array.isArray(value) ? (value as unknown[])[days.index] : undefined;
  return wholeDays(value);
}

/**
 * The calendar day a date column holds. Postgres and MySQL hand a `date` back
 * as a JavaScript date at this server's local midnight, so it is read with
 * local getters; a timestamp is read as the day it is on the venue's clock.
 */
export function dayOf(column: Pick<ResolvedColumn, 'logicalType'> | undefined, value: unknown, zone: string): string | null {
  if (value === null || value === undefined) return null;
  if (column !== undefined && column.logicalType !== 'date') {
    const instant = slotInstant(value);
    return instant === null ? null : venueClock(instant, zone).day;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return /^(\d{4}-\d{2}-\d{2})/.exec(String(value))?.[1] ?? null;
}

/** `YYYY-MM-DD` plus some days. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The moment a message of this producer comes due for the row it is about:
 * its date plus the days, at the wake time on the venue's clock. Null when
 * any input is missing.
 */
export async function dueFor(
  due: DueSpec,
  row: Row,
  dateColumn: Pick<ResolvedColumn, 'logicalType'> | undefined,
  zone: string,
  read: SettingReader,
): Promise<number | null> {
  const day = dayOf(dateColumn, row[due.date], zone);
  if (day === null) return null;
  const days = await daysFor(due.days, row, read);
  if (days === null) return null;
  return wallTimeToInstant(`${addDays(day, days)}T${due.at ?? DEFAULT_WAKE}`, zone)?.getTime() ?? null;
}

/** Whether a row meets one `dropWhen` condition. An empty value never meets `lte` or `gte`. */
function meets(condition: DropCondition, row: Row): boolean {
  const value = row[condition.column];
  if (condition.isNull !== undefined) return (value === null || value === undefined) === condition.isNull;
  if (condition.in !== undefined) return condition.in.some((candidate) => sameValue(candidate, value));
  if (condition.eq !== undefined) return sameValue(condition.eq, value);
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return false;
  // Postgres and MySQL read a decimal back as text ("0.0000").
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return condition.lte !== undefined ? n <= condition.lte : condition.gte !== undefined ? n >= condition.gte : false;
}

/** Why a waiting message is no longer needed, or null while it still is. */
export function dropReason(conditions: readonly DropCondition[] | undefined, row: Row | null): SkipReason | null {
  if (conditions === undefined || row === null) return null;
  return conditions.find((condition) => meets(condition, row))?.reason ?? null;
}

/** The producer a message of this kind came from: the first that makes it. */
export function producerOf(definition: Outbox, kind: unknown): OutboxProducer | undefined {
  return (definition.producers ?? []).find((producer) => producer.kind === kind);
}

/** The table a producer watches, and (for a child source) the foreign key to the row a message is about. */
export function sourceOf(producer: OutboxProducer): { table: string; via: string | undefined } {
  if ('onCreate' in producer) return { table: producer.onCreate.table, via: producer.onCreate.via };
  if ('onChange' in producer) return { table: producer.onChange.table, via: producer.onChange.via };
  return { table: producer.before.table, via: undefined };
}

/** Each kind of a `supersede` group, ranked in the order its producers are declared. */
export function groupRanks(definition: Outbox, group: string): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const producer of definition.producers ?? []) {
    if (producer.supersede === group && !ranks.has(producer.kind)) ranks.set(producer.kind, ranks.size);
  }
  return ranks;
}

/**
 * Whether a message of a supersede group has come due: sent or tried, or
 * waiting with its due moment passed. A skipped one has not.
 */
export function cameDue(status: unknown, due: unknown, now: number): boolean {
  if (status === 'sent' || status === 'failed') return true;
  if (status !== 'held' && status !== 'queued') return false;
  const instant = slotInstant(due);
  return instant !== null && instant.getTime() <= now;
}

/** What the error column says of a skip when the outbox keeps no reason column. */
export function skipSentence(reason: SkipReason): string {
  switch (reason) {
    case 'overtaken':
      return 'Overtaken by a later message';
    case 'paid':
      return 'No longer needed: paid';
    case 'void':
      return 'No longer needed: void';
    case 'by-hand':
      return 'Skipped by hand';
    default:
      return 'No longer needed';
  }
}
