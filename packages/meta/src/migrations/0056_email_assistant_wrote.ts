// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0056 — a mail the assistant wrote and no person has looked at since.
 *
 * ─── `adminium_email_templates.assistant_wrote_at` ───
 * The assistant sends a campaign only when a person has seen what it would
 * send. That used to be read from `enabled`, which a campaign has no switch
 * for: every campaign was created with it off, so none could ever be sent
 * through the assistant, a person's own included.
 *
 * This column is the look itself. It is set when the assistant writes a mail
 * (a draft it saved, a save over an open one, a language it added), carried
 * onto a copy of such a mail, and cleared when a person saves the mail or
 * says it looks right. NULL on every row written before this wave: none of
 * them can have been sent through the assistant, and each was last saved by a
 * person or by a seed.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('email_templates')).addColumn('assistant_wrote_at', c.ts).execute();
}
