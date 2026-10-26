// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0068 — what marketing mail needs kept secret: the addresses the mail
 * services call back on, and the keys that sign the mail.
 *
 * Neither belongs in a setting. `email.senders` is a portable plain list (a
 * config bundle carries it to another server, and nothing in it is
 * encrypted), and a setting marks a whole key secret, never one field. So
 * each gets a table of its own, with its secrets in the server's AES-GCM
 * envelope (`enc:v1:`), under keys of their own purpose.
 *
 * ─── `email_notice_endpoints`: one row per mail service ────────────────────
 * A mail service (Amazon SES, Postmark, Mailgun, Brevo, SendGrid, or another)
 * tells Adminium when a mail bounced, was marked as spam, or was unsubscribed
 * through the service's own link. Each service proves its calls its own way,
 * and every one of them also carries a long random token in its address:
 * - `token_hash` (sha256 of the token) finds the row a call came to;
 *   `token_encrypted` keeps the token itself, so the settings card can show
 *   the address again for the owner to copy.
 * - `secret_encrypted`: what proves a call, when it is a secret — Mailgun's
 *   signing key, or the user name and password Adminium made for Postmark,
 *   Brevo, or another service (they sign nothing). `secret_set_at` is the
 *   card's "Set on …".
 * - `public_key`: SendGrid's verification key. Public, so kept as it is.
 * - `topic_arn`: the Amazon SNS topic the owner named; a call from any other
 *   topic is refused. `confirmed_at`: when SNS's subscription handshake was
 *   answered.
 * - `last_notice_at` and `notice_count`: the card's "Last notice 2 h ago".
 * One row per service (`service` is unique): the card picks one service.
 *
 * ─── `email_dkim_keys`: one row per sending domain and selector ────────────
 * Adminium signs marketing mail itself (DKIM). The private key is encrypted;
 * the public key is what the DNS record publishes, so it is kept as it is.
 *
 * Both tables name their creator with a named, table-level foreign key (MySQL
 * parses an inline REFERENCES and drops it), SET NULL so removing a person
 * keeps the setup they made.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** An SNS topic ARN: `arn:aws:sns:<region>:<account>:<name>`, the name at most 256. */
const TOPIC_ARN = 320;
/** A DNS name: at most 253 characters. */
const DOMAIN = 253;
/** One DNS label. */
const SELECTOR = 63;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('email_notice_endpoints'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    // `ses`, `postmark`, `mailgun`, `brevo`, `sendgrid` or `other`.
    .addColumn('service', c.str(16), (col) => col.notNull())
    .addColumn('token_hash', c.str(64), (col) => col.notNull())
    .addColumn('token_encrypted', c.text, (col) => col.notNull())
    .addColumn('secret_encrypted', c.text)
    .addColumn('secret_set_at', c.ts)
    .addColumn('public_key', c.text)
    .addColumn('topic_arn', c.str(TOPIC_ARN))
    .addColumn('confirmed_at', c.ts)
    .addColumn('last_notice_at', c.ts)
    .addColumn('notice_count', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_email_notice_endpoints_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_email_notice_endpoints_service')
    .on(metaTable('email_notice_endpoints'))
    .columns(['service'])
    .unique()
    .execute();
  await db.schema
    .createIndex('uq_adminium_email_notice_endpoints_token')
    .on(metaTable('email_notice_endpoints'))
    .columns(['token_hash'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('email_dkim_keys'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('domain', c.str(DOMAIN), (col) => col.notNull())
    .addColumn('selector', c.str(SELECTOR), (col) => col.notNull())
    .addColumn('private_key_encrypted', c.text, (col) => col.notNull())
    // The `p=` value of the DNS record: the public key, base64 of its DER.
    .addColumn('public_key', c.text, (col) => col.notNull())
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_email_dkim_keys_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_email_dkim_keys_domain_selector')
    .on(metaTable('email_dkim_keys'))
    .columns(['domain', 'selector'])
    .unique()
    .execute();
}
