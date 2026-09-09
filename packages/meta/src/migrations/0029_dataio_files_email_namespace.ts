// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0029 — three more message groups left `common`, so the operator's
 * rewordings of them have to move with the messages. Same shape, and the same
 * reasoning, as 0022 (the Studio's namespace move); read that file first.
 *
 * ─── What moved, and why ───────────────────────────────────────────────────
 *
 * `common.dataio.*` (207 keys), `common.files.*` (69) and `common.email.*`
 * (143) became the `dataio`, `files` and `email` namespaces. `common` is
 * bundled into every user's first load, so a key that lives there is paid for
 * on every route by every user no matter how lazy its surface is — and these
 * three surfaces are the import wizard, the exports manager, the export
 * builder and the Files library, all behind lazy routes. The `email` group was
 * the starkest case: all 143 of its call sites are in `apps/server`'s email
 * template machinery, so a dashboard user was downloading text their browser
 * can never render. The entry-chunk ratchet is what finally noticed.
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
 * ─── The three carried keys ────────────────────────────────────────────────
 *
 * Three keys did not make the trip, because their readers cannot await a
 * deferred namespace:
 *
 * - `dataio.import.title` / `dataio.exports.title` are read by
 *   `data-io/routes.tsx`, which the router imports statically and which is
 *   therefore IN the entry chunk. They were byte-identical to
 *   `common:nav.imports` / `nav.exports`, so that module reads those instead.
 * - `files.uploadsUnavailable` is read by the `page-files` TEMPLATE, which
 *   renders inside a user-built page that never awaits the `files` namespace.
 *   The widget already falls back to a byte-identical
 *   `ui:templates.files.uploadsUnavailable`.
 *
 * An override on any of the three is COPIED to the surviving twin rather than
 * only moved — 0022's argument exactly: an operator who renamed something
 * should not find half the product using their word and half not. The original
 * row still moves with its group, where it is inert (a namespace that has no
 * such key resolves nothing), because silently deleting text an admin wrote is
 * the worse failure. Note the third target is in a DIFFERENT namespace, which
 * is why `CARRIED` carries one rather than assuming `common`.
 *
 * ─── No version bump ───────────────────────────────────────────────────────
 *
 * As in 0022: the i18n version counter in `adminium_settings` is untouched. A
 * cached override under a key that no longer exists is inert, and the next
 * ordinary write moves the counter anyway.
 */

import type { Kysely } from 'kysely';

import { newId } from '../ids.js';
import { metaTable } from '../prefix.js';

/** Local view over the columns this touches. */
interface TranslationRow {
  id: string;
  scope: string;
  locale: string;
  namespace: string;
  key: string;
  value: string;
  // camelCase: the meta instance runs `CamelCasePlugin` (connect.ts), so a
  // query builder names `source_text` as `sourceText`.
  sourceText: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}
type MoveDb = Kysely<Record<string, TranslationRow>>;

/** The three groups, longest-prefix-irrelevant here since they do not nest. */
const MOVED: readonly { prefix: string; namespace: string }[] = [
  { prefix: 'dataio.', namespace: 'dataio' },
  { prefix: 'files.', namespace: 'files' },
  { prefix: 'email.', namespace: 'email' },
];

/** Old `common` key → the address its surviving twin answers to. */
const CARRIED: Readonly<Record<string, { namespace: string; key: string }>> = {
  'dataio.import.title': { namespace: 'common', key: 'nav.imports' },
  'dataio.exports.title': { namespace: 'common', key: 'nav.exports' },
  'files.uploadsUnavailable': { namespace: 'ui', key: 'templates.files.uploadsUnavailable' },
};

// No column-helpers parameter: this wave adds no column. Like 0022 it moves
// DATA rather than shape, and a declared-but-unused helper would suggest
// otherwise.
export async function up(db: Kysely<unknown>): Promise<void> {
  const table = metaTable('translations');
  const moveDb = db as MoveDb;

  const rows = await moveDb
    .selectFrom(table)
    .select(['id', 'scope', 'locale', 'namespace', 'key', 'value', 'sourceText', 'updatedBy', 'createdAt', 'updatedAt'])
    .where('namespace', '=', 'common')
    .execute();

  for (const row of rows) {
    const group = MOVED.find((m) => row.key.startsWith(m.prefix));
    if (group === undefined) continue;

    // Copy BEFORE the move, while the row still says what it used to. Guarded
    // rather than assumed unique: the unique index is
    // (scope, locale, namespace, key), and an admin who had already overridden
    // the twin by hand must not lose the row they wrote.
    const carried = CARRIED[row.key];
    if (carried !== undefined) {
      const existing = await moveDb
        .selectFrom(table)
        .select('id')
        .where('scope', '=', row.scope)
        .where('locale', '=', row.locale)
        .where('namespace', '=', carried.namespace)
        .where('key', '=', carried.key)
        .executeTakeFirst();
      if (existing === undefined) {
        await moveDb
          .insertInto(table)
          .values({
            id: newId('trn'),
            scope: row.scope,
            locale: row.locale,
            namespace: carried.namespace,
            key: carried.key,
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
      .set({ namespace: group.namespace, key: row.key.slice(group.prefix.length) })
      .where('id', '=', row.id)
      .execute();
  }
}
