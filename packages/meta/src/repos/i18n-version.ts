/**
 * The runtime-translation version stamp (23-runtime-translations.md §3.4).
 *
 * Clients key their bundle cache — and the server its ETag — on this counter,
 * so it must move on EVERY mutation of `adminium_locales` /
 * `adminium_translations`, from every writer.
 *
 * Two decisions are load-bearing:
 *
 *  1. **A counter, not `MAX(updated_at)`.** Reset-to-built-in is a hard
 *     DELETE, so a max-timestamp over the rows cannot observe the single most
 *     common admin operation — the cache would go stale exactly when someone
 *     undoes a bad edit.
 *  2. **Bumped in the repo layer, not in route handlers.** Config-bundle
 *     import has no HTTP route: it writes through repos from the CLI. A
 *     route-level bump would leave every client serving stale strings after
 *     an import, forever, with the ETag answering 304.
 *
 * Always call this inside the same transaction as the write it stamps.
 */

import type { Kysely, Transaction } from 'kysely';

import type { MetaDB } from '../schema/tables.js';
import { packJson, readJson } from './util.js';

const VERSION_KEY = 'i18n.version';

export type MetaExecutor = Kysely<MetaDB> | Transaction<MetaDB>;

/** Read the current stamp (0 when no override row exists yet). */
export async function readI18nVersion(db: MetaExecutor): Promise<number> {
  const row = await db
    .selectFrom('adminium_settings')
    .select(['value'])
    .where('key', '=', VERSION_KEY)
    .executeTakeFirst();
  if (row === undefined) return 0;
  const parsed = readJson<unknown>(row.value);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Increment the stamp and return the new value. Upserts by hand rather than
 * through settingsRepo because that repo owns its own connection handle and
 * this has to join the caller's transaction.
 */
export async function bumpI18nVersion(
  db: MetaExecutor,
  at: number,
  updatedBy: string | null,
): Promise<number> {
  const next = (await readI18nVersion(db)) + 1;
  const packed = packJson(next);
  const res = await db
    .updateTable('adminium_settings')
    .set({ value: packed, updatedAt: at, updatedBy })
    .where('key', '=', VERSION_KEY)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0) {
    await db
      .insertInto('adminium_settings')
      .values({ key: VERSION_KEY, value: packed, updatedAt: at, updatedBy })
      .execute();
  }
  return next;
}
