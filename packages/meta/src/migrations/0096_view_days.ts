// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0096 — how many times strangers saw a page or a form, per day.
 *
 * One row per counted thing, kind, place and day:
 *
 *  - `install_id`: the add-on install that holds the thing (its
 *    `adminium_manifests` id; an add-on installs per database);
 *  - `kind`: `page` (a landing page), `form-page` (a form on its own page, or
 *    in a frame on the owner's website), `form-opened` (a form block on a
 *    landing page came near the screen) or `form-sent` (an answer was kept);
 *  - `thing`: the counted row's key, as text (a page's, a form's);
 *  - `place`: the page key a form sat on, `''` for none (its own page, a
 *    frame). Never NULL: a NULL in a key column never collides on SQLite, so
 *    the portable add would make two rows of one;
 *  - `day`: `YYYY-MM-DD` in the business's own time zone, as text (a `date`
 *    column is shifted by some drivers);
 *  - `views`: the count, added to, never replaced.
 *
 * The server adds up counts in memory and writes them at most once a minute
 * with the meta store's portable add (UPDATE, INSERT, UPDATE again on a
 * duplicate key). No row is ever written for a zero. The days older than the
 * keeping setting (`privacy.viewCountsMonths`) are swept daily.
 *
 * No foreign key: an install removed leaves its counts until their sweep, as
 * the public API's request counts are left.
 *
 * Each step asks first, so a run stopped part way on MySQL (which keeps every
 * statement before the stop) is finished by the next.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

/** The longest install id (an add-on install's `adminium_manifests` id). */
export const VIEW_INSTALL_WIDTH = 64;
/** The longest kind: `form-opened`. */
export const VIEW_KIND_WIDTH = 16;
/** The longest row key counted, and the longest place (a page key). */
export const VIEW_THING_WIDTH = 64;
export const VIEW_PLACE_WIDTH = 64;
/** A day, `YYYY-MM-DD`. */
export const VIEW_DAY_WIDTH = 10;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('view_days'))
    .ifNotExists()
    .addColumn('install_id', c.str(VIEW_INSTALL_WIDTH), (col) => col.notNull())
    .addColumn('kind', c.str(VIEW_KIND_WIDTH), (col) => col.notNull())
    .addColumn('thing', c.str(VIEW_THING_WIDTH), (col) => col.notNull())
    .addColumn('place', c.str(VIEW_PLACE_WIDTH), (col) => col.notNull())
    .addColumn('day', c.str(VIEW_DAY_WIDTH), (col) => col.notNull())
    .addColumn('views', c.bigint, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_view_days', ['install_id', 'kind', 'thing', 'place', 'day'])
    .execute();
  // The daily sweep: every day before the keeping cutoff.
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_view_days_day', metaTable('view_days'), ['day']);
}
