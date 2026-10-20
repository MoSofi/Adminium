// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0061 — payments.
 *
 * A shop's customers pay what they owe on a provider's hosted page; Adminium
 * records the payment against the invoice or record, exactly once, across two
 * databases that never share a transaction (this store and the shop's).
 *
 * ─── Money is text ─────────────────────────────────────────────────────────
 * Every amount is a decimal STRING ("120.00", "45.250"), never a number
 * column: SQLite's REAL makes 0.1 + 0.2 a different amount, and a payment is
 * the one place that may not happen. Arithmetic is decimal-string arithmetic.
 *
 * ─── "Unique while open" is a key that is NULLed ───────────────────────────
 * One open attempt per payable and one current link per payable. A partial
 * unique index cannot be written portably (0031 says why), so each table
 * carries a key that is set while the row is open/current and set to NULL
 * when it leaves that state; NULLs are exempt from unique on all three
 * dialects (the 0005 precedent).
 *
 * ─── The tables ────────────────────────────────────────────────────────────
 * - `payment_attempts`: one try to pay one payable at one provider. Its id is
 *   its idempotency key at the provider. Moves only by compare-and-set.
 * - `payment_events`: every webhook (and every status change a poll found),
 *   unique on (provider, mode, event id); swept by retention.
 * - `payments`: the payments Adminium keeps ITSELF (designer invoices; tables
 *   with no payments table of their own). `attempt_id` is unique, so
 *   recording is insert-first: a duplicate means "already recorded".
 * - `refunds`: each refund, its idempotency key minted at the confirm step.
 * - `payment_links`: a pay link's token, hashed (to find it) and sealed (to
 *   print it again), one current per payable.
 * - `payable_profiles`: a table an admin marked payable, and how.
 * - `payment_methods`: the ways to pay and their per-market rules.
 * - `payment_settings`: the pay page, the pay address, cursors, counters of
 *   provider reads, webhook health — small documents under a key.
 * - `payment_counters`: card-testing caps per link, IP and install, per hour.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** A decimal amount as text: 18 digits, a point, 6 decimals, with room to spare. */
const AMOUNT = 40;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('payment_attempts'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('provider', c.str(80), (col) => col.notNull())
    .addColumn('mode', c.str(8), (col) => col.notNull())
    .addColumn('account_id', c.str(255))
    // What is paid: a table row (kind `shape` or `profile`) or a designer invoice (`document`).
    .addColumn('payable_kind', c.str(16), (col) => col.notNull())
    .addColumn('connection_id', c.id)
    .addColumn('table_name', c.str(255))
    .addColumn('row_key', c.str(512), (col) => col.notNull())
    .addColumn('payable_label', c.str(255), (col) => col.notNull())
    .addColumn('amount', c.str(AMOUNT), (col) => col.notNull())
    .addColumn('currency', c.str(3), (col) => col.notNull())
    .addColumn('state', c.str(20), (col) => col.notNull())
    // `<connection>:<table>:<row>` or `document:<id>` until the payment is recorded or refused; NULL after.
    .addColumn('open_key', c.str(600))
    .addColumn('link_id', c.id)
    // Carried in the return URL and checked server-side; binds a return to this attempt.
    .addColumn('nonce', c.str(64), (col) => col.notNull())
    .addColumn('provider_ref', c.str(255))
    .addColumn('checkout_url', c.str(2048))
    .addColumn('payment_ref', c.str(255))
    .addColumn('taken_amount', c.str(AMOUNT))
    .addColumn('taken_currency', c.str(3))
    .addColumn('paid_with', c.json)
    // Why it stopped short: a refusal code and the sentence staff see.
    .addColumn('problem', c.json)
    // The shop row (or kept payment) the payment became.
    .addColumn('recorded_key', c.str(512))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addColumn('settled_at', c.ts)
    .addColumn('recorded_at', c.ts)
    .addColumn('flagged_at', c.ts)
    .execute();
  await db.schema.createIndex('uq_adminium_payment_attempts_open_key').on(metaTable('payment_attempts')).columns(['open_key']).unique().execute();
  await db.schema
    .createIndex('uq_adminium_payment_attempts_provider_ref')
    .on(metaTable('payment_attempts'))
    .columns(['provider', 'mode', 'provider_ref'])
    .unique()
    .execute();
  await db.schema.createIndex('ix_adminium_payment_attempts_state').on(metaTable('payment_attempts')).columns(['state', 'updated_at']).execute();
  await db.schema.createIndex('ix_adminium_payment_attempts_payment_ref').on(metaTable('payment_attempts')).columns(['payment_ref']).execute();
  await db.schema.createIndex('ix_adminium_payment_attempts_nonce').on(metaTable('payment_attempts')).columns(['nonce']).execute();

  await db.schema
    .createTable(metaTable('payment_events'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('provider', c.str(80), (col) => col.notNull())
    .addColumn('mode', c.str(8), (col) => col.notNull())
    .addColumn('event_id', c.str(255), (col) => col.notNull())
    .addColumn('type', c.str(120), (col) => col.notNull())
    .addColumn('kind', c.str(16), (col) => col.notNull())
    .addColumn('checkout_ref', c.str(255))
    .addColumn('payment_ref', c.str(255))
    .addColumn('refund_ref', c.str(255))
    .addColumn('attempt_id', c.id)
    // `webhook`, `sweep` or `poll` (a status a poll found changed, under a synthetic event id).
    .addColumn('source', c.str(16), (col) => col.notNull())
    .addColumn('body', c.json)
    .addColumn('received_at', c.ts, (col) => col.notNull())
    .addColumn('processed_at', c.ts)
    .execute();
  await db.schema
    .createIndex('uq_adminium_payment_events_event')
    .on(metaTable('payment_events'))
    .columns(['provider', 'mode', 'event_id'])
    .unique()
    .execute();
  await db.schema.createIndex('ix_adminium_payment_events_processed').on(metaTable('payment_events')).columns(['processed_at', 'received_at']).execute();

  await db.schema
    .createTable(metaTable('payments'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('payable_kind', c.str(16), (col) => col.notNull())
    .addColumn('connection_id', c.id)
    .addColumn('table_name', c.str(255))
    .addColumn('row_key', c.str(512), (col) => col.notNull())
    // `<connection>:<table>:<row>` or `document:<id>`, to sum a payable's payments with one index.
    .addColumn('payable_key', c.str(600), (col) => col.notNull())
    .addColumn('number', c.str(40))
    .addColumn('amount', c.str(AMOUNT), (col) => col.notNull())
    .addColumn('currency', c.str(3), (col) => col.notNull())
    .addColumn('refunded_amount', c.str(AMOUNT), (col) => col.notNull().defaultTo('0'))
    .addColumn('method', c.str(40), (col) => col.notNull())
    .addColumn('method_note', c.str(120))
    .addColumn('provider', c.str(80))
    .addColumn('mode', c.str(8), (col) => col.notNull())
    // The attempt it came from; unique, so recording an online payment is insert-first.
    .addColumn('attempt_id', c.id)
    .addColumn('approval_code', c.str(12))
    .addColumn('card_last4', c.str(4))
    .addColumn('note', c.str(500))
    .addColumn('paid_on', c.ts, (col) => col.notNull())
    .addColumn('recorded_by', c.str(255), (col) => col.notNull())
    .addColumn('recorded_by_user', c.id)
    .addColumn('voided', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('void_reason', c.str(500))
    .addColumn('voided_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema.createIndex('uq_adminium_payments_attempt').on(metaTable('payments')).columns(['attempt_id']).unique().execute();
  await db.schema.createIndex('ix_adminium_payments_payable').on(metaTable('payments')).columns(['payable_key']).execute();

  await db.schema
    .createTable(metaTable('refunds'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('attempt_id', c.id)
    .addColumn('payment_id', c.id)
    .addColumn('provider', c.str(80), (col) => col.notNull())
    .addColumn('mode', c.str(8), (col) => col.notNull())
    .addColumn('payment_ref', c.str(255), (col) => col.notNull())
    .addColumn('amount', c.str(AMOUNT), (col) => col.notNull())
    .addColumn('currency', c.str(3), (col) => col.notNull())
    .addColumn('reason', c.str(32), (col) => col.notNull())
    .addColumn('note', c.str(500))
    .addColumn('state', c.str(20), (col) => col.notNull())
    .addColumn('idempotency_key', c.str(80), (col) => col.notNull())
    .addColumn('provider_refund_id', c.str(255))
    // `staff` (made in Adminium) or `provider` (made in the provider's dashboard, then recorded and flagged).
    .addColumn('source', c.str(16), (col) => col.notNull())
    .addColumn('requested_by', c.id)
    .addColumn('failure_message', c.str(2000))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addColumn('settled_at', c.ts)
    // When the shop's record took the refund, and when a later failure undid it.
    .addColumn('applied_at', c.ts)
    .addColumn('undone_at', c.ts)
    .execute();
  await db.schema.createIndex('uq_adminium_refunds_idempotency').on(metaTable('refunds')).columns(['idempotency_key']).unique().execute();
  await db.schema
    .createIndex('uq_adminium_refunds_provider_id')
    .on(metaTable('refunds'))
    .columns(['provider', 'mode', 'provider_refund_id'])
    .unique()
    .execute();
  await db.schema.createIndex('ix_adminium_refunds_payment_ref').on(metaTable('refunds')).columns(['payment_ref']).execute();

  await db.schema
    .createTable(metaTable('payment_links'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('token_hash', c.str(64), (col) => col.notNull())
    .addColumn('token_sealed', c.str(512), (col) => col.notNull())
    .addColumn('payable_kind', c.str(16), (col) => col.notNull())
    .addColumn('connection_id', c.id)
    .addColumn('table_name', c.str(255))
    .addColumn('row_key', c.str(512), (col) => col.notNull())
    .addColumn('mode', c.str(8), (col) => col.notNull())
    // The payable's key while this is its current link; NULL once replaced, revoked or dead.
    .addColumn('current_key', c.str(600))
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('revoked_at', c.ts)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema.createIndex('uq_adminium_payment_links_token').on(metaTable('payment_links')).columns(['token_hash']).unique().execute();
  await db.schema.createIndex('uq_adminium_payment_links_current').on(metaTable('payment_links')).columns(['current_key']).unique().execute();

  await db.schema
    .createTable(metaTable('payable_profiles'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('table_name', c.str(255), (col) => col.notNull())
    // Amount, currency, due, payments mapping, status, customer columns, pay-page fields.
    .addColumn('mapping', c.json, (col) => col.notNull())
    .addColumn('owner_app', c.str(80))
    .addColumn('enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_payable_profiles_connection_id', ['connection_id'], metaTable('connections'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_payable_profiles_table')
    .on(metaTable('payable_profiles'))
    .columns(['connection_id', 'table_name'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('payment_methods'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    // `manual` for a way to pay by hand; otherwise the provider add-on's key.
    .addColumn('source', c.str(80), (col) => col.notNull())
    .addColumn('method', c.str(64), (col) => col.notNull())
    .addColumn('label', c.json)
    .addColumn('enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .addColumn('rules', c.json, (col) => col.notNull())
    .addColumn('details', c.json)
    .addColumn('position', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema.createIndex('uq_adminium_payment_methods_method').on(metaTable('payment_methods')).columns(['source', 'method']).unique().execute();

  await db.schema
    .createTable(metaTable('payment_settings'))
    .ifNotExists()
    .addColumn('name', c.str(200), (col) => col.primaryKey())
    .addColumn('value', c.json, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();

  await db.schema
    .createTable(metaTable('payment_counters'))
    .ifNotExists()
    .addColumn('bucket', c.str(200), (col) => col.notNull())
    .addColumn('window_start', c.ts, (col) => col.notNull())
    .addColumn('hits', c.int, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_payment_counters', ['bucket', 'window_start'])
    .execute();
}
