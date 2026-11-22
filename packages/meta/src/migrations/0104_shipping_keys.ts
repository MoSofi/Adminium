// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0104 — who a shop's carrier key belongs to, and what packers may spend.
 *
 * `adminium_shipping_accounts`, one row per carrier add-on install: what the
 * carrier said of the saved key when it was last checked (test or live, which
 * carriers answer), a keyed fingerprint of the account and a keyed hash of the
 * key itself, so a key changed by any other way reads as one nobody checked.
 * The key stays in the encrypted credential store. This row holds only its
 * last four characters.
 *
 * `adminium_shipping_limits`, one row per app install: the most one label may
 * cost and how many labels a day, for everyone who books without managing
 * shipping. No row, or no figures, means the owner books.
 *
 * `adminium_shipping_day_labels`, one row per app install and shop day: the
 * labels counted against the daily limit. Reserved before a purchase, so two
 * at once never pass the limit together.
 *
 * `adminium_shipping_quotes.account_fingerprint`: the account a quote was
 * priced under, so a rate from before a key change is never bought on the new
 * account. Null on a quote from before this wave, which is not bought either.
 *
 * No foreign key: MySQL drops an inline REFERENCES, and the rows of an install
 * are deleted by the code that removes it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { columnExists } from './probe.js';
import { SHIPPING_HASH_WIDTH, SHIPPING_ID_WIDTH } from './0103_shipping.js';

/** `live` or `test`. */
export const SHIPPING_MODE_WIDTH = 8;
/** `ok` or `refused`. */
export const SHIPPING_ACCOUNT_STATE_WIDTH = 12;
/** The last four characters of a key. */
export const SHIPPING_KEY_HINT_WIDTH = 4;
/** A decimal amount, as text so it stays exact. */
export const SHIPPING_MONEY_WIDTH = 24;
/** An ISO 4217 code. */
export const SHIPPING_CURRENCY_WIDTH = 3;
/** A shop day, `YYYY-MM-DD`. */
export const SHIPPING_DAY_WIDTH = 10;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('shipping_accounts'))
    .ifNotExists()
    .addColumn('carrier_install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.primaryKey())
    .addColumn('mode', c.str(SHIPPING_MODE_WIDTH), (col) => col.notNull())
    .addColumn('fingerprint', c.str(SHIPPING_HASH_WIDTH), (col) => col.notNull())
    .addColumn('key_hash', c.str(SHIPPING_HASH_WIDTH), (col) => col.notNull())
    .addColumn('key_hint', c.str(SHIPPING_KEY_HINT_WIDTH), (col) => col.notNull())
    .addColumn('state', c.str(SHIPPING_ACCOUNT_STATE_WIDTH), (col) => col.notNull())
    .addColumn('carriers', c.json, (col) => col.notNull())
    .addColumn('checked_by', c.str(SHIPPING_ID_WIDTH))
    .addColumn('checked_at', c.ts, (col) => col.notNull())
    .execute();

  await db.schema
    .createTable(metaTable('shipping_limits'))
    .ifNotExists()
    .addColumn('install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.primaryKey())
    .addColumn('label_limit', c.str(SHIPPING_MONEY_WIDTH))
    .addColumn('label_currency', c.str(SHIPPING_CURRENCY_WIDTH))
    .addColumn('daily_labels', c.int)
    .addColumn('packers_abroad', c.bool, (col) => col.notNull())
    .addColumn('updated_by', c.str(SHIPPING_ID_WIDTH))
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();

  await db.schema
    .createTable(metaTable('shipping_day_labels'))
    .ifNotExists()
    .addColumn('install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.notNull())
    .addColumn('day', c.str(SHIPPING_DAY_WIDTH), (col) => col.notNull())
    .addColumn('labels', c.int, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_shipping_day_labels', ['install_id', 'day'])
    .execute();

  // Asked first: MySQL commits each DDL, so a run stopped part way comes back to a column already there.
  if (!(await columnExists(db, c.dialect, metaTable('shipping_quotes'), 'account_fingerprint'))) {
    await db.schema.alterTable(metaTable('shipping_quotes')).addColumn('account_fingerprint', c.str(SHIPPING_HASH_WIDTH)).execute();
  }
}
