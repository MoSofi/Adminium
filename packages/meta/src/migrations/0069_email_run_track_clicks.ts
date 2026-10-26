// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0069 — whether a campaign run counts clicks.
 *
 * Click counting is off unless the person sending switches it on: each link of the mail is then signed and sent through Adminium so a
 * click counts on its send log row. The switch is chosen on the send screen
 * and kept on the run, so every batch of that run (a later one, after a
 * restart) reads the same answer. Off for every run made before.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('email_runs'))
    .addColumn('track_clicks', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .execute();
}
