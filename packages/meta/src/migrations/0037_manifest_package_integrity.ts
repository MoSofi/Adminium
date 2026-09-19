// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0037 — `adminium_manifests.package_integrity`: the fingerprint of the
 * copy kept in the storage destination.
 *
 * ─── WHY THE ROW HAS TO CARRY IT ──────────────────────────────────────────
 * An installed package's files live only in `ADMINIUM_DATA_DIR/{apps,add-ons}`.
 * A host with no persistent disk empties that directory on every deploy, so the
 * row survives and the bytes do not. Keeping a copy elsewhere is only half an
 * answer: something has to say WHICH copy belongs to this install and whether
 * the bytes that come back are the right ones.
 *
 * The storage destination cannot answer either question. Its listing is not a
 * record of what was installed — a pruned or edited bucket would simply be
 * obeyed — and a path that carries its own hash proves only that an object
 * matches its own name. So the fingerprint lives here, beside the install it
 * belongs to, and the destination holds bytes that must match it.
 *
 * ─── WHY NOT REUSE WHAT IS ALREADY ON THE ROW ─────────────────────────────
 * `source` looks like it should help and cannot: every add-on records
 * `marketplace` and a downloaded app records `file`, so it does not identify
 * where a package can be fetched from again. Nothing else on the row describes
 * the bytes at all.
 *
 * ─── THE VALUE ────────────────────────────────────────────────────────────
 * `sha512-<base64>`, npm's Subresource-Integrity spelling — the same string
 * `npm pack` prints, the release ledger records, the catalog carries and the
 * sideload route asks an operator for, so this column is comparable with all
 * of them without a conversion. 95 characters exactly (7 + 88); 120 leaves
 * room for a longer algorithm without another wave.
 *
 * ─── AND WHERE THE COPY IS ────────────────────────────────────────────────
 * `package_file_id` points at the `adminium_files` row holding the bytes. The
 * copy is written through the ordinary file store rather than to a path of its
 * own because a storage key is not a path: `isSafeStorageKey` is `isId(key,
 * 'file')`, so `packages/app/clinic/1.0.0.tgz` is refused by every driver.
 * Going through the store also means the destination, the spooling and the
 * per-driver differences are already solved.
 *
 * The file row carries `kind = 'package'`, which keeps it clear of the daily
 * sweep: `listUnattachedBefore` is scoped to `kind = 'upload'` precisely
 * because every other kind is a system artifact with its own lifecycle. A copy
 * written as an upload would be collected 24 hours later, having never been
 * attached to a record.
 *
 * ─── BOTH NULL, OR NEITHER ────────────────────────────────────────────────
 * NULL means no copy is held, which is the honest state for every row that
 * predates this wave and for every instance with no storage destination
 * configured. There is deliberately no backfill in SQL: a fingerprint can only
 * be written once the bytes have actually been uploaded, which is a boot-time
 * pass over the store, not something a migration can do.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/**
 * `sha512-` plus 88 base64 characters is 95. The bound is wider than that on
 * purpose and still bounded, because this value reaches a log line and an
 * error message.
 */
export const PACKAGE_INTEGRITY_MAX = 120;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('manifests'))
    .addColumn('package_integrity', c.str(PACKAGE_INTEGRITY_MAX))
    .execute();
  // Two ALTERs rather than one: MySQL accepts multiple ADD COLUMN clauses,
  // SQLite accepts exactly one per statement, and kysely emits what it is
  // given. Separate statements are the shape all three engines take.
  await db.schema
    .alterTable(metaTable('manifests'))
    .addColumn('package_file_id', c.id)
    .execute();
}
