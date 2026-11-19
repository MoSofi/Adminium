// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0097 — "Per visitor": the visitors who said yes, and the pages each
 * of them saw.
 *
 * `adminium_visitors`, one row per "yes" on the banner:
 *
 *  - `id`: a keyed hash of the random id the visitor's cookie holds; the
 *    cookie's own value is never stored;
 *  - `host`: where the "yes" was given (the install's address and a mapped
 *    pages host are two cookies, so two visitors, never joined);
 *  - `said_yes_at` and `wording_version`: the proof of the "yes", and which
 *    words of the banner it answered;
 *  - `address_hash` and `key_version`: set when the visitor sends a form,
 *    the answer's address under the address keys (the do-not-email list's
 *    keyed hash), so a person's data finds and erases them by address;
 *  - `last_seen_at`: the visitor's last counted view.
 *
 * `adminium_visits`, one row per counted view of a visitor: the visitor, the
 * install, the kind and the thing, and when. Written in the counter's minute
 * flush, never one write per view.
 *
 * Neither is ever archived (an archive would keep visits past an erasure and
 * past their months); both go with the person; going down from "Per visitor"
 * deletes them all. No foreign key: MySQL drops an inline REFERENCES, and the
 * visits are deleted with their visitor by the code that deletes either.
 *
 * Each step asks first, so a run stopped part way on MySQL (which keeps every
 * statement before the stop) is finished by the next.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';
import { VIEW_INSTALL_WIDTH, VIEW_KIND_WIDTH, VIEW_THING_WIDTH } from './0096_view_days.js';

/** A visitor's id: a keyed hash, as hex. */
export const VISITOR_ID_WIDTH = 64;
/** The longest host name. */
export const VISITOR_HOST_WIDTH = 253;
/** The banner's wording version. */
export const VISITOR_WORDING_WIDTH = 32;
/** An address hash, as the consent log and the do-not-email list keep it. */
export const VISITOR_ADDRESS_HASH_WIDTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('visitors'))
    .ifNotExists()
    .addColumn('id', c.str(VISITOR_ID_WIDTH), (col) => col.primaryKey())
    .addColumn('host', c.str(VISITOR_HOST_WIDTH), (col) => col.notNull())
    .addColumn('said_yes_at', c.ts, (col) => col.notNull())
    .addColumn('wording_version', c.str(VISITOR_WORDING_WIDTH), (col) => col.notNull())
    .addColumn('address_hash', c.str(VISITOR_ADDRESS_HASH_WIDTH))
    .addColumn('key_version', c.int)
    .addColumn('last_seen_at', c.ts, (col) => col.notNull())
    .execute();
  // A person's data: their visitors, by the address's keyed hash.
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_visitors_address', metaTable('visitors'), ['address_hash', 'key_version']);
  // The sweep: visitors not seen for longer than the visits are kept.
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_visitors_seen', metaTable('visitors'), ['last_seen_at']);

  await db.schema
    .createTable(metaTable('visits'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('visitor_id', c.str(VISITOR_ID_WIDTH), (col) => col.notNull())
    .addColumn('install_id', c.str(VIEW_INSTALL_WIDTH), (col) => col.notNull())
    .addColumn('kind', c.str(VIEW_KIND_WIDTH), (col) => col.notNull())
    .addColumn('thing', c.str(VIEW_THING_WIDTH), (col) => col.notNull())
    .addColumn('at', c.ts, (col) => col.notNull())
    .execute();
  // One visitor's pages (a person's data, a withdrawal).
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_visits_visitor', metaTable('visits'), ['visitor_id']);
  // The sweep: visits older than their months.
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_visits_at', metaTable('visits'), ['at']);
}
