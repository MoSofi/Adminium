// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0072 — the desktop first-run wizard's messages moved inside `common`,
 * from `desktop.setup.*` to the deferred `onboarding.desktopSetup.*`, so the
 * operator's rewordings of them have to move with the messages. The shape and
 * the reasoning are 0043's (and 0022's, 0029's); read those first.
 *
 * ─── What moved, and why ───────────────────────────────────────────────────
 *
 * `common` is bundled into every user's first load, but its `onboarding` group
 * is one of `COMMON_DEFERRED_GROUPS` and loads with the screens that read it.
 * The desktop wizard's 88 messages are read only by `/desktop/setup`, a lazy
 * route a desktop user sees once, before they have an account. The entry-chunk
 * ratchet was 866 bytes from red after finding V29 added six strings; this
 * group is what pays for them.
 *
 * Unlike 0043 the NAMESPACE does not change, only the key: an override filed
 * as (`common`, `desktop.setup.x`) becomes (`common`, `onboarding.desktopSetup.x`).
 * Nothing stays behind: the wizard is the group's only reader, and it waits
 * for the deferred group before it renders.
 *
 * ─── No version bump ───────────────────────────────────────────────────────
 *
 * As in 0022 and 0043: a cached override under a key that no longer exists is
 * inert, and the next ordinary write moves the i18n counter anyway.
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

const FROM = 'desktop.setup.';
const TO = 'onboarding.desktopSetup.';

// No column-helpers parameter: like 0043 this moves DATA, not shape.
export async function up(db: Kysely<unknown>): Promise<void> {
  const table = metaTable('translations');
  const moveDb = db as MoveDb;

  const rows = await moveDb
    .selectFrom(table)
    .select(['id', 'key'])
    .where('namespace', '=', 'common')
    .execute();

  for (const row of rows) {
    if (!row.key.startsWith(FROM)) continue;
    await moveDb
      .updateTable(table)
      .set({ key: TO + row.key.slice(FROM.length) })
      .where('id', '=', row.id)
      .execute();
  }
}
