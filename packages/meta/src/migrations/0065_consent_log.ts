// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0065 — the consent log, and the keys addresses are hashed under.
 *
 * ─── The log is the record ─────────────────────────────────────────────────
 * One row per consent event, never changed afterwards: a yes, a no, or a
 * "replied" (a contact answered a marketing e-mail, which stops their
 * sequences). A person's state for a purpose is their latest row for it.
 * A withdrawal is a later "no" row whose source and detail say how it was
 * withdrawn (the e-mail link, a bounce, a staff member); a confirmed sign-up
 * is a row whose `confirmed_at` says when. A yes/no column an app declares
 * mirrors one purpose of this log, written from it (the server's consent
 * door), never the other way round.
 *
 * The only rows ever deleted are a person's own, when the person is erased.
 *
 * ─── Who ───────────────────────────────────────────────────────────────────
 * A person is a row of a source table: its connection, its table (the
 * snapshot id, as the audit log names tables) and its key as text. All three
 * are empty for an event that names only an address (an unsubscribe from a
 * mail whose person is gone). The address is never kept here in clear: only
 * its keyed hash, and the version of the key it was hashed under.
 *
 * ─── The address keys ──────────────────────────────────────────────────────
 * `adminium_address_keys` holds the keys addresses are hashed under, by
 * version. Each is 32 random bytes made once per install, stored encrypted
 * (`enc:v1:`) under a key taken from the server's secret. The hash therefore
 * does not change when the secret does: a change of secret re-encrypts these
 * few rows, and every stored hash (the stop list's too, an erased person's
 * included) keeps matching. A new version is made only when the key itself
 * is replaced; rows hashed under an older version are found under it, so no
 * version is ever deleted.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** As long as the audit log's entity keys (`AUDIT_ENTITY_KEY_MAX`). */
const CONSENT_KEY_MAX = 200;
/** A keyed hash: HMAC-SHA256 as hex. */
const ADDRESS_HASH_LENGTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('address_keys'))
    .ifNotExists()
    .addColumn('version', c.int, (col) => col.primaryKey())
    // The key itself, `enc:v1:` under the server's secret.
    .addColumn('key_encrypted', c.text, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();

  await db.schema
    .createTable(metaTable('consent_log'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    // The person: all three set, or all three empty for an address-only event.
    .addColumn('connection_id', c.id)
    .addColumn('person_table', c.str(CONSENT_KEY_MAX))
    .addColumn('person_key', c.str(CONSENT_KEY_MAX))
    // The address, hashed; empty when the event named a person whose address was not known.
    .addColumn('address_hash', c.str(ADDRESS_HASH_LENGTH))
    .addColumn('key_version', c.int)
    // `newsletter`, `surveys`, …; empty for a "replied" row, which is about every purpose.
    .addColumn('purpose', c.str(40))
    // `yes`, `no` or `replied`.
    .addColumn('state', c.str(12), (col) => col.notNull())
    // `form`, `import`, `staff`, `review`, `unsubscribe`, `relay`, `bounce`, `system`, `person`.
    .addColumn('source', c.str(20), (col) => col.notNull())
    // The form's or the relay's name, or one of the fixed words (`before-records`, `send-review`, …).
    .addColumn('detail', c.str(255))
    // A staff member's record: how the person agreed (`in-person`, `phone`, `email`, `paper`) and a note.
    .addColumn('how', c.str(20))
    .addColumn('note', c.text)
    .addColumn('staff_id', c.id)
    .addColumn('staff_label', c.str(255))
    // The wording the person was shown, and its version.
    .addColumn('wording', c.text)
    .addColumn('wording_version', c.str(40))
    // A public sign-up's network address and browser.
    .addColumn('ip', c.str(64))
    .addColumn('user_agent', c.str(512))
    .addColumn('at', c.ts, (col) => col.notNull())
    .addColumn('confirmed_at', c.ts)
    .execute();
  // A person's latest row for a purpose; their history; their rows deleted with them.
  await db.schema
    .createIndex('ix_adminium_consent_log_person')
    .on(metaTable('consent_log'))
    .columns(['connection_id', 'person_table', 'person_key', 'purpose', 'at'])
    .execute();
  // An address's latest row for a purpose, under each key version.
  await db.schema
    .createIndex('ix_adminium_consent_log_address')
    .on(metaTable('consent_log'))
    .columns(['address_hash', 'key_version', 'purpose', 'at'])
    .execute();
}
