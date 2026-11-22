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
 * transaction.
 *
 * A KEY MADE BY A KEY named no maker before this release. The audit log still
 * says which key made it, so it is traced back to the person first, and from
 * then on it stops with them. A key with no maker and no such trail (its maker
 * was deleted for good, or the entry has passed the audit log's retention)
 * stays: nothing says whose it was.
 */
import { MysqlAdapter, type Kysely } from 'kysely';

import { newId } from '../ids.js';
import { metaTable } from '../prefix.js';

type Store = Kysely<Record<string, Record<string, unknown>>>;

/** What an audit entry's `changes` holds: text on some engines, parsed on others. */
function madeKeyOf(changes: unknown): string | null {
  let read = changes;
  if (typeof read === 'string') {
    try {
      read = JSON.parse(read);
    } catch {
      return null;
    }
  }
  const made = (read as { after?: { apiKeyId?: unknown } } | null)?.after?.apiKeyId;
  return typeof made === 'string' ? made : null;
}

/** Names the person behind each working key that was made by a key, following the audit log from key to key. */
async function traceKeyMadeKeys(store: Store): Promise<void> {
  const made = await store.selectFrom(metaTable('audit_log')).select(['actorId', 'changes']).where('action', '=', 'api-key.create').where('actorKind', '=', 'api-key').execute();
  if (made.length === 0) return;
  const madeBy = new Map<string, string>();
  for (const entry of made) {
    const child = madeKeyOf(entry['changes']);
    if (child !== null && typeof entry['actorId'] === 'string') madeBy.set(child, entry['actorId']);
  }
  const keys = await store.selectFrom(metaTable('api_keys')).select(['id', 'createdBy', 'revokedAt']).execute();
  const makerOf = new Map(keys.map((key) => [key['id'] as string, key['createdBy'] as string | null]));
  for (const key of keys) {
    if (key['createdBy'] !== null || key['revokedAt'] !== null) continue;
    const seen = new Set<string>();
    let at: string | undefined = key['id'] as string;
    let maker: string | null = null;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      maker = makerOf.get(at) ?? null;
      if (maker !== null) break;
      at = madeBy.get(at);
    }
    if (maker !== null) await store.updateTable(metaTable('api_keys')).set({ createdBy: maker }).where('id', '=', key['id'] as string).where('createdBy', 'is', null).execute();
  }
}

async function revokeHeld(store: Store, at: number): Promise<void> {
  await traceKeyMadeKeys(store);
  // camelCase: the meta instance runs `CamelCasePlugin`.
  const suspended = await store.selectFrom(metaTable('users')).select(['id', 'email', 'name']).where('status', '=', 'suspended').execute();
  if (suspended.length === 0) return;
  const makers = new Map(suspended.map((user) => [user['id'] as string, user]));
  const keys = await store.selectFrom(metaTable('api_keys')).select(['id', 'name', 'prefix', 'roleId', 'createdBy']).where('revokedAt', 'is', null).where('createdBy', 'is not', null).execute();
  for (const key of keys) {
    const maker = makers.get(key['createdBy'] as string);
    if (maker === undefined) continue;
    // First: a key something else revoked a moment ago is not this upgrade's to report.
    const revoked = await store.updateTable(metaTable('api_keys')).set({ revokedAt: at }).where('id', '=', key['id'] as string).where('revokedAt', 'is', null).executeTakeFirst();
    if (Number(revoked.numUpdatedRows) !== 1) continue;
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
