// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0051 — a rule records what shipped it.
 *
 * ─── `adminium_automations.managed_by`, `.template_key`, `.content_hash` ───
 * An app or an add-on may ship automation rules. Such a rule belongs to what
 * shipped it: an update rewrites it, an uninstall takes it away — unless the
 * owner changed it, and then it is theirs and is left alone. So a shipped
 * rule keeps the key of its manifest (`managed_by`), the name its manifest
 * gave it (`template_key`), and a fingerprint of what was written
 * (`content_hash`): a rule whose content no longer matches its fingerprint
 * was edited. The same three an email template already keeps.
 *
 * All three are empty on every rule an owner made, before this wave and
 * after it.
 *
 * ─── one rule a key, a manifest and a database ─────────────────────────────
 * A plain unique index over (`managed_by`, `template_key`, `connection_id`).
 * An owner's rules hold NULL in the first two, and NULLs are distinct in a
 * unique index on SQLite, Postgres and MySQL alike — so they never meet it,
 * and no partial index or second check is needed.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('automations')).addColumn('managed_by', c.str(80)).execute();
  await db.schema.alterTable(metaTable('automations')).addColumn('template_key', c.str(80)).execute();
  await db.schema.alterTable(metaTable('automations')).addColumn('content_hash', c.str(64)).execute();
  await db.schema
    .createIndex('uq_adminium_automations_managed')
    .on(metaTable('automations'))
    .columns(['managed_by', 'template_key', 'connection_id'])
    .unique()
    .execute();
}
