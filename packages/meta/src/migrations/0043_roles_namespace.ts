// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0043 — the Roles & permissions editor's messages left `common`, so the
 * operator's rewordings of them have to move with the messages. The same
 * shape, and the same reasoning, as 0022 (the Studio's namespace move) and
 * 0029 (`dataio`, `files` and `email`); read those first.
 *
 * ─── What moved, and why ───────────────────────────────────────────────────
 *
 * `common.roles.*` (76 keys) became the `roles` namespace. `common` is bundled
 * into every user's first load, so a key that lives there is paid for on every
 * route by every user — and these are read by exactly one screen,
 * `/settings/roles`, a lazy route behind a permission the built-in Admin does
 * not even hold. The entry-chunk ratchet went red on two new strings, and
 * this group is what paid for them.
 *
 * `adminium_translations` files a row by `(scope, locale, namespace, key)`, so
 * an override an admin wrote against the old address stops resolving the
 * moment the message answers to a new one. Nothing errors; the string reverts
 * to compiled English for exactly the people who reworded it.
 *
 * JavaScript rather than SQL, for 0022's reason: `substr` and concatenation
 * are spelled three ways across sqlite, postgres and mysql, and the row count
 * is bounded by how many messages a human has personally rewritten.
 *
 * ─── No carried keys ───────────────────────────────────────────────────────
 *
 * Unlike 0029, every key made the trip: the Roles page is the group's only
 * reader, and its route awaits the namespace before it renders. So there is no
 * twin to copy an override to, and nothing stays behind in `common`.
 *
 * ─── No version bump ───────────────────────────────────────────────────────
 *
 * As in 0022: the i18n version counter in `adminium_settings` is untouched. A
 * cached override under a key that no longer exists is inert, and the next
 * ordinary write moves the counter anyway.
 */

import type { Kysely } from 'kysely';

import { metaTable } from '../prefix.js';

/** Local view over the columns this touches. */
interface TranslationRow {
  id: string;
  namespace: string;
  key: string;
}
type MoveDb = Kysely<Record<string, TranslationRow>>;

const PREFIX = 'roles.';
const NAMESPACE = 'roles';

// No column-helpers parameter: this wave adds no column. Like 0022 it moves
// DATA rather than shape, and a declared-but-unused helper would suggest
// otherwise.
export async function up(db: Kysely<unknown>): Promise<void> {
  const table = metaTable('translations');
  const moveDb = db as MoveDb;

  const rows = await moveDb
    .selectFrom(table)
    .select(['id', 'key'])
    .where('namespace', '=', 'common')
    .execute();

  for (const row of rows) {
    if (!row.key.startsWith(PREFIX)) continue;
    await moveDb
      .updateTable(table)
      .set({ namespace: NAMESPACE, key: row.key.slice(PREFIX.length) })
      .where('id', '=', row.id)
      .execute();
  }
}
