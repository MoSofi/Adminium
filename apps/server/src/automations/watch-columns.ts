// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DOES THIS TABLE QUALIFY FOR WATCHING? (the owner's "listener".)
 *
 * A route trigger only ever sees writes Adminium itself made. The sign-up
 * example the whole feature was asked for is a row the CUSTOMER'S OWN APP
 * inserts, which never touches `routes/data`; without a poller the rule looks
 * built and does nothing for the case it exists to serve. The poller needs
 * one thing from a table: a column whose values only go UP, so "everything
 * since last tick" is a bounded query rather than a full scan.
 *
 * Three shapes qualify, in this order:
 *
 *  1. a `created-at` / `updated-at` column the schema classifier already
 *     tagged (r09/r10) — the common case, and the reason this reads the
 *     snapshot's semantics instead of re-inventing a name vocabulary;
 *  2. any timestamp column literally named `created_at` / `updated_at` whose
 *     semantics were never computed (an older snapshot, an overridden model);
 *  3. for `created` only, a single-column integer primary key — an
 *     auto-increment id is a creation order even when nobody stamped a time.
 *
 * `deleted` never qualifies: a deleted row leaves no tombstone to poll for,
 * so a delete rule sees Adminium's own deletes and says so in the inspector.
 */

import type { ResolvedTable } from '../crud/identifiers.js';

export type WatchEvent = 'created' | 'updated';

export interface WatchColumn {
  column: string;
  /** `timestamp` cursors compare instants; `sequence` cursors compare integers. */
  kind: 'timestamp' | 'sequence';
}

const CREATED_NAMES = new Set([
  'created_at',
  'created_on',
  'created',
  'creation_date',
  'date_created',
  'inserted_at',
]);
const UPDATED_NAMES = new Set([
  'updated_at',
  'updated_on',
  'modified_at',
  'last_modified',
  'updatedat',
]);
const TIMESTAMP_TYPES = new Set(['date', 'timestamp', 'timestamptz']);
const SEQUENCE_TYPES = new Set(['integer', 'bigint']);

/** The column the poller reads, or null when the table cannot be watched. */
export function watchColumnFor(table: ResolvedTable, event: WatchEvent): WatchColumn | null {
  const wanted = event === 'created' ? 'created-at' : 'updated-at';
  for (const column of table.table.columns) {
    if (column.semantics?.primary === wanted && TIMESTAMP_TYPES.has(column.logicalType)) {
      return { column: column.name, kind: 'timestamp' };
    }
  }
  const names = event === 'created' ? CREATED_NAMES : UPDATED_NAMES;
  for (const column of table.table.columns) {
    if (names.has(column.name.toLowerCase()) && TIMESTAMP_TYPES.has(column.logicalType)) {
      return { column: column.name, kind: 'timestamp' };
    }
  }
  if (event === 'created' && table.primaryKey.length === 1) {
    const pk = table.columns.get(table.primaryKey[0] as string);
    if (pk && SEQUENCE_TYPES.has(pk.logicalType)) return { column: pk.name, kind: 'sequence' };
  }
  return null;
}

/**
 * The column whose value makes one UPDATE distinct from the next — the third
 * component of an `updated` occurrence key (D6). It is the `updated-at`
 * column and nothing else: without one, two updates to the same row are two
 * occurrences, which is the honest answer.
 */
export function changeStampColumn(table: ResolvedTable): string | null {
  return watchColumnFor(table, 'updated')?.column ?? null;
}
