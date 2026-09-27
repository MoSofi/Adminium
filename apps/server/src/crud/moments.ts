// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MOMENTS ON THE SERVER — the one place a rule turns a stored value, or a
 * manifest `Moment`, into an instant.
 *
 * A hold ends at a moment (an order's own `held_until`, or a waitlist offer's
 * end on the row it links to); a move may be allowed only after one moment
 * and before another; a timed move fires when one has passed; a stamp may
 * write one; a guest's change may be open only until one. Every reader of a
 * moment goes through here, so a hold's end, a window and a timed move agree
 * to the second, on the venue's clock, whatever zone the server runs in.
 *
 * Two readers are plain and built: {@link readInstant} (a stored time as the
 * instant it denotes — a zone-less value is this server's wall clock, which
 * is what the write path stores and the drivers read back) and
 * {@link readDay} (a stored date as `YYYY-MM-DD`). {@link momentOf} reads a
 * whole `Moment` — a linked row, a venue wall time, a shift, a fallback.
 *
 * What a moment is compared WITH is the write's clock (`write-clock.ts`), read
 * inside the transaction after the locks.
 */
import type { Kysely } from 'kysely';
import type { Moment, PlainMoment } from '@adminium/manifest';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { notBuiltYet } from './not-built.js';

/*
 * A leaf: the guard, the states and the jobs all read moments, so this
 * module reads none of them.
 */

/**
 * A stored time as the instant it denotes, or null (empty, or not a time).
 * A zone-less value is this server's wall clock — how the write path stores
 * one and how the drivers read one back (`crud/write-values.ts`).
 */
export function readInstant(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const instant = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** A stored date as `YYYY-MM-DD`: a driver's Date at local midnight, or the text's first ten characters; null when empty. */
export function readDay(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? null;
}

/** Reads a one-row setting a moment names (`{table, column}`) through the write's own handle, once per write. */
export type MomentSettings = (setting: { table: string; column: string }) => Promise<unknown>;

/** Everything a moment may read, as the write holds it. */
export interface MomentContext {
  /** The table of the row the moment is read from (its column types say date or time). */
  table: ResolvedTable;
  /** The row as it stands (stored values with the write's over them). */
  row: Row;
  /**
   * The rows the row's links point at, by the link column: held for share
   * inside the transaction by the reader that asks (null when the link is
   * empty or the row is gone). A moment through a link not here reads nothing.
   */
  linked: ReadonlyMap<string, Row | null>;
  /** The venue's time zone. */
  zone: string;
  settings: MomentSettings;
  /** The write's handle (inside its transaction when judging). */
  db: Kysely<SourceDatabase>;
}

/**
 * The instant a moment names for this row, or null when there is none (an
 * empty column, a missing linked row, an unreadable setting — the first of
 * `or` that answers stands in). What null means is the reader's rule: a
 * condition refuses, a timed move never fires, a late rule is not late, a
 * stamp writes empty.
 */
export async function momentOf(moment: Moment | PlainMoment, context: MomentContext): Promise<Date | null> {
  void moment;
  void context;
  return notBuiltYet('momentOf');
}
