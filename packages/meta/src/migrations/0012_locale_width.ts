// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0012 — widen the locale columns (23-runtime-translations.md §3.5).
 *
 * `adminium_user_prefs.locale` (0001) and `adminium_email_templates.locale`
 * (0006) were sized `str(5)` for `en_US`. An admin-created locale id may carry
 * a script subtag (`zh_Hant_TW`, 11 chars) and the registry allows up to 35,
 * so both columns must widen or a custom locale can never be stored as a user
 * preference or carry an email variant.
 *
 * SQLite masked the mismatch as usual (`str(n)` maps to `text`, lengths
 * unenforced); PostgreSQL and strict-mode MySQL would reject the write.
 *
 * Up-only rule (index.ts): 0001 and 0006 are applied and checksummed, so this
 * ships as a compensating migration rather than an edit. Raw dialect-branched
 * ALTERs following 0010 verbatim, because MySQL's MODIFY restates the WHOLE
 * column definition and Kysely's `setDataType` would silently drop the rest.
 *
 * NULLABILITY IS NOT SYMMETRIC HERE — get this wrong and the migration
 * changes data semantics:
 *   - `user_prefs.locale` is NULLABLE (0001 line 44: no `.notNull()`); NULL
 *     means "inherit the workspace default", which is the whole
 *     reset-to-default affordance. MySQL's MODIFY must NOT add NOT NULL.
 *   - `email_templates.locale` is NOT NULL DEFAULT 'en_US' (0006 line 232);
 *     MySQL's MODIFY must restate both.
 */

import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const userPrefs = metaTable('user_prefs');
  const emailTemplates = metaTable('email_templates');

  if (c.dialect === 'postgres') {
    await sql`ALTER TABLE ${sql.table(userPrefs)} ALTER COLUMN locale TYPE varchar(35)`.execute(db);
    await sql`ALTER TABLE ${sql.table(emailTemplates)} ALTER COLUMN locale TYPE varchar(35)`.execute(
      db,
    );
  } else if (c.dialect === 'mysql') {
    // Nullable — restating NOT NULL here would destroy "inherit the default".
    await sql`ALTER TABLE ${sql.table(userPrefs)} MODIFY COLUMN locale varchar(35) NULL`.execute(db);
    await sql`ALTER TABLE ${sql.table(emailTemplates)} MODIFY COLUMN locale varchar(35) NOT NULL DEFAULT 'en_US'`.execute(
      db,
    );
  }
  // sqlite: both columns are `text`; nothing to widen.
}
