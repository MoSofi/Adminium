// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH INSTANTS ARE ALREADY TAKEN — the read behind a calendar's struck-out
 * days and slots.
 *
 * ─── Why a DISTINCT and not a count ────────────────────────────────────────
 *
 * The question a booking calendar asks is "which of the slots I am about to
 * draw does a row already hold". Answering it by reading rows is wrong at
 * exactly the moment it matters: every read on this server is capped, and past
 * the cap a taken slot renders FREE, which costs somebody a double booking.
 * `SELECT DISTINCT` bounds the reply by the number of SLOTS in the window
 * instead — a month of quarter-hours is 2,976 of them, whatever the table's
 * row count — so a cap can be honest, and when it is reached the caller is
 * TOLD rather than shown a wrong half.
 *
 * ─── Why the record being edited is excluded here ──────────────────────────
 *
 * A booking's own Edit dialog would otherwise strike out the very slot the
 * booking holds, leaving no way to save it without moving it. The exclusion
 * has to happen in the query rather than in the browser: the client cannot
 * exclude a row the cap already dropped.
 *
 * ─── What it refuses ───────────────────────────────────────────────────────
 *
 * A column that is not temporal (there is nothing to put on a calendar), and a
 * column this caller may not read in clear. A masked column's distinct values
 * ARE its values — answering with them would hand out, one query, the thing
 * the mask exists to withhold.
 */
import { sql, type Kysely, type RawBuilder } from 'kysely';

import type { Dialect } from '@adminium/engine';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';

/**
 * Most distinct instants one read answers with. A month of quarter-hour slots
 * is 2,976; anything past that is a window nobody draws, so the cap is a
 * refusal to compute rather than a page size.
 */
export const AVAILABILITY_CAP = 2000;

/** The column types a calendar can stand on. */
const TEMPORAL = new Set(['date', 'timestamp', 'timestamptz']);

export interface AvailabilityQuery {
  /** The temporal column the calendar is bound to. */
  column: string;
  /** Inclusive lower bound and EXCLUSIVE upper bound, as wire strings. */
  from: string;
  to: string;
  /** A column whose value scopes the question — the room, the practitioner. */
  resource?: string | undefined;
  resourceValue?: string | undefined;
  /** The record this read is for, whose own instant is not "taken" (C2). */
  exclude?: Row | undefined;
}

export interface Availability {
  /** The distinct instants held in the window, as the driver returned them. */
  taken: string[];
  /**
   * The cap was reached, so `taken` is a PREFIX and not the answer. A caller
   * that strikes anything out on a capped reply is lying about the rest.
   */
  capped: boolean;
}

/**
 * Resolve the two columns against the snapshot, refusing by name.
 *
 * `readableColumn` answers the mask question (and secrets) for us; what is
 * added here is the type, because a calendar over a `varchar` would silently
 * return whatever strings the column holds.
 */
export function availabilityColumns(
  view: SnapshotView,
  table: ResolvedTable,
  query: AvailabilityQuery,
  pii: boolean,
): { instant: string; resource: string | null } {
  const instant = view.readableColumn(table, query.column, pii);
  if (!TEMPORAL.has(instant.logicalType)) {
    throw new ValidationFailedError(
      `${JSON.stringify(instant.name)} is a ${instant.logicalType} column, so it has no days to show.`,
      { column: instant.name, logicalType: instant.logicalType },
    );
  }
  const resource =
    query.resource === undefined ? null : view.readableColumn(table, query.resource, pii).name;
  return { instant: instant.name, resource };
}

/**
 * SQLite compares text, so both sides have to be spelled the same way.
 *
 * Postgres and MySQL parse a wire literal into their own temporal type and
 * compare instants. SQLite stores whatever text was written — Adminium's own
 * write path spells a naive timestamp `YYYY-MM-DD HH:MM:SS`, but a caller
 * writing through the API may well have stored an ISO `T`, and `'T' > ' '` in
 * every collation, so a lexicographic range would silently skip the rows that
 * disagree with the bound's spelling. `datetime()` normalizes BOTH sides to
 * one form, which is the only comparison on that engine that answers the
 * question actually being asked.
 */
function temporal(dialect: Dialect, column: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return dialect === 'sqlite' ? sql`datetime(${ref})` : sql`${ref}`;
}

function bound(dialect: Dialect, value: string): RawBuilder<unknown> {
  return dialect === 'sqlite' ? sql`datetime(${value})` : sql`${value}`;
}

/**
 * The distinct instants held in `[from, to)`.
 *
 * One row per distinct value and one extra to detect the cap — the same
 * limit+1 shape every other read on this path uses.
 */
export async function readAvailability(
  db: Kysely<SourceDatabase>,
  dialect: Dialect,
  table: ResolvedTable,
  columns: { instant: string; resource: string | null },
  query: AvailabilityQuery,
): Promise<Availability> {
  const instant = temporal(dialect, columns.instant);
  let statement = db
    .selectFrom(table.id)
    .select(() => instant.as('instant'))
    .distinct()
    .where(() => sql<boolean>`${instant} >= ${bound(dialect, query.from)}`)
    .where(() => sql<boolean>`${instant} < ${bound(dialect, query.to)}`)
    .limit(AVAILABILITY_CAP + 1);

  if (columns.resource !== null && query.resourceValue !== undefined) {
    const resource = columns.resource;
    statement = statement.where((eb) => eb(db.dynamic.ref(resource), '=', query.resourceValue));
  }
  if (query.exclude !== undefined) {
    // Not `<>` on the key: a composite key needs every component to differ
    // together, and `NOT (a = ? AND b = ?)` is the only spelling that says so.
    const pk = query.exclude;
    statement = statement.where((eb) =>
      eb.not(
        eb.and(table.primaryKey.map((name) => eb(db.dynamic.ref(name), '=', pk[name] as never))),
      ),
    );
  }

  const rows = (await statement.execute()) as { instant: unknown }[];
  const capped = rows.length > AVAILABILITY_CAP;
  return {
    capped,
    // A capped reply answers with NOTHING: a prefix of the taken set drawn as
    // the taken set marks free everything the cap cut off.
    taken: capped ? [] : rows.map((row) => instantText(row.instant)),
  };
}

/**
 * One instant as the wire carries it.
 *
 * Drivers answer a temporal column with a `Date` (postgres, mysql) or with the
 * text they stored (sqlite). Both become the ISO-ish wall-clock string the
 * form controls already speak, so the browser compares strings and converts
 * nothing — the write path owns the conversion, and a second one here is how
 * a slot grid comes to disagree with the row it just wrote.
 */
function instantText(value: unknown): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (value instanceof Date) {
    return (
      `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
      `T${pad(value.getHours())}:${pad(value.getMinutes())}`
    );
  }
  const text = String(value ?? '');
  // `2026-09-17 09:00:00` (what SQLite stores and `datetime()` answers with)
  // and `2026-09-17` (a date column) both become the one wire shape, so the
  // browser compares strings and converts nothing.
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text);
  if (match === null) return text;
  return `${match[1] as string}T${match[2] ?? '00'}:${match[3] ?? '00'}`;
}
