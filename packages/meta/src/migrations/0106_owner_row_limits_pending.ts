// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0106 — the installs whose stored row limits are still to be sorted.
 *
 * From this release a role's row records which limits its owner set. Limits
 * stored earlier do not say, and only the app version that wrote them can
 * tell. Every install here at the upgrade is listed; the server sorts each one
 * at start and takes it off the list, and until then no update changes what
 * an install's roles are limited to. A store with no installs lists nothing.
 */
import type { Kysely } from 'kysely';

import { metaTable } from '../prefix.js';

type Store = Kysely<Record<string, Record<string, unknown>>>;

const KEY = 'system.ownerRowLimitsPending';

export async function up(db: Kysely<unknown>): Promise<void> {
  const store = db as unknown as Store;
  const installs = await store.selectFrom(metaTable('manifests')).select('id').execute();
  if (installs.length === 0) return;
  const value = JSON.stringify(installs.map((row) => row['id'] as string).sort());
  // A run stopped after this line finds the row and leaves it: what was sorted since stays sorted.
  const held = await store.selectFrom(metaTable('settings')).select('key').where('key', '=', KEY).executeTakeFirst();
  if (held !== undefined) return;
  await store.insertInto(metaTable('settings')).values({ key: KEY, value, updatedAt: Date.now(), updatedBy: null }).execute();
}
