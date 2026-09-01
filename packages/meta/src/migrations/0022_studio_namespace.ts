// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0022 — the Studio's messages moved namespace, so the operator's
 * rewordings of them have to move with the messages (10-T06).
 *
 * ─── What moved, and why it is not a rename ────────────────────────────────
 *
 * `common.studio.*` and `common.studioPages.*` — 971 keys, the whole admin
 * console — became the `studio` namespace's `*` and `pages.*`. The point was
 * bundle weight: `studio` is fetched when somebody opens the Studio instead of
 * shipping in every user's first load. But `adminium_translations` files a row
 * by `(scope, locale, namespace, key)`, so an override an admin wrote against
 * the old address stops resolving the moment the message answers to a new one.
 * Nothing errors. The string simply reverts to the compiled English, on the
 * one surface whose users are the people who did the rewording.
 *
 * So this is a DATA move, in JavaScript rather than SQL: `substr` and string
 * concatenation are spelled three different ways across sqlite, postgres and
 * mysql, and the row count here is bounded by how many messages a human has
 * personally rewritten.
 *
 * ─── The two carried keys ──────────────────────────────────────────────────
 *
 * The topbar's Studio menu used to title its two items from `studio.hub.title`
 * and `studio.settingsHub.title`. It paints on every route, long before any
 * Studio chunk exists, so it now has its own `common:topbar.*` keys.
 *
 * An override on either old key is COPIED to the new one rather than only
 * moved. The alternative is an operator who renamed "Data connections" to
 * "Databases" finding the page still says Databases and the menu item that
 * opens it saying Data connections — a split they did not ask for and cannot
 * see the cause of. The cost is honest and small: two rows where there was
 * one, so a later reset has to be done twice. Preserving what they configured
 * is worth more than saving them a click they may never make.
 *
 * ─── No version bump ───────────────────────────────────────────────────────
 *
 * The i18n version counter in `adminium_settings` is what makes a warm browser
 * refetch. It is deliberately untouched: a cached override under a key that no
 * longer exists resolves for nothing and is inert, and the next ordinary write
 * moves the counter anyway.
 */

import type { Kysely } from 'kysely';

import { newId } from '../ids.js';
import { metaTable } from '../prefix.js';

/** Local view over the four columns this touches. */
interface TranslationRow {
  id: string;
  scope: string;
  locale: string;
  namespace: string;
  key: string;
  value: string;
  // camelCase: the meta instance runs `CamelCasePlugin`, so a query builder
  // names `source_text` as `sourceText` (connect.ts). DDL elsewhere in this
  // directory spells the physical names because the schema builder is where
  // they are declared.
  sourceText: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}
type MoveDb = Kysely<Record<string, TranslationRow>>;

/** Old `common` key → its address in the `studio` namespace. */
function movedKey(key: string): string | null {
  if (key.startsWith('studioPages.')) return `pages.${key.slice('studioPages.'.length)}`;
  if (key.startsWith('studio.')) return key.slice('studio.'.length);
  return null;
}

/** Old `common` key → the `common` key the topbar reads it from now. */
const CARRIED: Readonly<Record<string, string>> = {
  'studio.hub.title': 'topbar.dataConnections',
  'studio.settingsHub.title': 'topbar.workspaceSettings',
};

// No column-helpers parameter: this wave adds no column. It is the only
// migration in this directory that moves DATA rather than shape, and a
// declared-but-unused helper would suggest otherwise.
export async function up(db: Kysely<unknown>): Promise<void> {
  const table = metaTable('translations');
  const moveDb = db as MoveDb;

  const rows = await moveDb
    .selectFrom(table)
    .select(['id', 'scope', 'locale', 'namespace', 'key', 'value', 'sourceText', 'updatedBy', 'createdAt', 'updatedAt'])
    .where('namespace', '=', 'common')
    .execute();

  for (const row of rows) {
    const moved = movedKey(row.key);
    if (moved === null) continue;

    // Copy BEFORE the move, while the row still says what it used to. Guarded
    // rather than assumed unique: the unique index is
    // (scope, locale, namespace, key), and an admin who had already
    // overridden `topbar.*` — impossible today, but this migration outlives
    // that fact — must not lose the row they wrote by hand.
    const carried = CARRIED[row.key];
    if (carried !== undefined) {
      const existing = await moveDb
        .selectFrom(table)
        .select('id')
        .where('scope', '=', row.scope)
        .where('locale', '=', row.locale)
        .where('namespace', '=', 'common')
        .where('key', '=', carried)
        .executeTakeFirst();
      if (existing === undefined) {
        await moveDb
          .insertInto(table)
          .values({
            id: newId('trn'),
            scope: row.scope,
            locale: row.locale,
            namespace: 'common',
            key: carried,
            value: row.value,
            sourceText: row.sourceText,
            updatedBy: row.updatedBy,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })
          .execute();
      }
    }

    await moveDb
      .updateTable(table)
      .set({ namespace: 'studio', key: moved })
      .where('id', '=', row.id)
      .execute();
  }
}
