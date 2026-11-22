// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0105 — the API keys of people suspended before the rule existed.
 *
 * From this release, stopping a person revokes every API key they made. This
 * does the same, once, for those already suspended, so no stopped person is
 * left with a working key. An integration running on such a key needs a new
 * one, which the release notes say.
 *
 * Each key revoked gets an audit entry saying whose it was, in the same
 * transaction. A key that names no maker stays: nothing says it was theirs.
 */
import { MysqlAdapter, type Kysely } from 'kysely';

import { newId } from '../ids.js';
import { metaTable } from '../prefix.js';

type Store = Kysely<Record<string, Record<string, unknown>>>;

async function revokeHeld(store: Store, at: number): Promise<void> {
  // camelCase: the meta instance runs `CamelCasePlugin`.
  const suspended = await store.selectFrom(metaTable('users')).select(['id', 'email', 'name']).where('status', '=', 'suspended').execute();
  if (suspended.length === 0) return;
  const makers = new Map(suspended.map((user) => [user['id'] as string, user]));
  const keys = await store.selectFrom(metaTable('api_keys')).select(['id', 'name', 'prefix', 'roleId', 'createdBy']).where('revokedAt', 'is', null).where('createdBy', 'is not', null).execute();
  for (const key of keys) {
    const maker = makers.get(key['createdBy'] as string);
    if (maker === undefined) continue;
    await store
      .insertInto(metaTable('audit_log'))
      .values({
        id: newId('aud'),
        createdAt: at,
        actorKind: 'system',
        actorId: null,
        actorLabel: 'Adminium',
        category: 'system',
        action: 'api-key.revoke',
        connectionId: null,
        entity: null,
        entityTable: null,
        entityId: null,
        changes: JSON.stringify({
          before: { apiKeyId: key['id'], name: key['name'], prefix: key['prefix'], roleId: key['roleId'], createdBy: maker['id'], createdByEmail: maker['email'], createdByName: maker['name'] },
          after: { reason: 'creator-already-suspended' },
        }),
        ip: null,
        userAgent: null,
        requestId: null,
      })
      .execute();
    await store.updateTable(metaTable('api_keys')).set({ revokedAt: at }).where('id', '=', key['id'] as string).where('revokedAt', 'is', null).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const store = db as unknown as Store;
  const at = Date.now();
  // Postgres and SQLite run a migration inside the migrator's transaction, on this same connection.
  // MySQL has no transactional DDL and runs it bare, and these rows must land together.
  if (store.getExecutor().adapter instanceof MysqlAdapter && !store.isTransaction) await store.transaction().execute((trx) => revokeHeld(trx, at));
  else await revokeHeld(store, at);
}
