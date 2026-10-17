// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0058 — the parts of an app, and a role's name in other languages.
 *
 * ─── `adminium_manifests.modules` ──────────────────────────────────────────
 * An app may be made of parts its owner switches on and off (`modules` in
 * its manifest). The installed row keeps the answer: for each part what the
 * manifest says of it (its default, the add-ons its feature needs) and the
 * owner's switch. Kept beside the manifest, not inside it, so that reading
 * "is this part on" never loads the manifest. NULL for an app with no parts.
 *
 * ─── `adminium_roles.modules`, `.names` ────────────────────────────────────
 * A role of such an app belongs to one or more parts and is offered while
 * any of them is on: the list of their ids. `names` holds the role's name in
 * the languages its manifest gave, with the name it was installed under, so
 * a reader sees their own language until the owner renames the role.
 *
 * ─── `adminium_automations.module`, `adminium_app_tables.module` ───────────
 * The part a shipped rule and an app's table belong to. A rule of a part
 * that is off is not run; a role of a part loses its grant on that part's
 * tables while the part is off.
 *
 * Every column is NULL on every row there is, and on everything that names
 * no part.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('manifests')).addColumn('modules', c.json).execute();
  await db.schema.alterTable(metaTable('roles')).addColumn('modules', c.json).execute();
  await db.schema.alterTable(metaTable('roles')).addColumn('names', c.json).execute();
  await db.schema.alterTable(metaTable('automations')).addColumn('module', c.str(40)).execute();
  await db.schema.alterTable(metaTable('app_tables')).addColumn('module', c.str(40)).execute();
}
