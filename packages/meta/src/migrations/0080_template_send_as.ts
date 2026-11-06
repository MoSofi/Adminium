// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0080 — "Send as" on an email template.
 *
 * Mail about a record goes from the sender of the workspace its database is
 * in (the first by position when it is in several), and mail with no record
 * from the server's own sender. A template may name its sender instead:
 *
 *  - NULL     — by the record, as above (every existing template);
 *  - `server` — the server's own sender, whatever the record;
 *  - a workspace id — that workspace's sender, whatever the record.
 *
 * No foreign key: `server` is not a workspace. Deleting a workspace sets the
 * templates that name it back to NULL (`workspacesRepo.remove`), and a send
 * that meets an id no longer there goes by the record.
 *
 * The value belongs to the template's family (every language of one key):
 * it is written to every row of the key, and read from any row that has it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** `server` or a workspace id (`wsp_` + 26), with room. */
export const TEMPLATE_SEND_AS_WIDTH = 40;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('email_templates')).addColumn('send_as', c.str(TEMPLATE_SEND_AS_WIDTH)).execute();
}
