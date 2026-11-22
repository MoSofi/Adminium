// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE API KEYS OF SOMEBODY WHO IS STOPPED ARE REVOKED, ALL OF THEM.
 *
 * A key acts with its own role, so stopping the person who made it would
 * otherwise leave it working. Every way of suspending or removing an account
 * revokes the keys that person made, in the transaction that stops them: there
 * is no moment where they are stopped and a key of theirs still works, and no
 * key is revoked for a stop that did not happen. Reactivating them does not
 * bring a key back. A shared integration running on such a key needs a new one.
 *
 * The audit log says who made each key. A removal for good empties the key's
 * `created_by`, so that entry is what is left to say whose it was.
 *
 * Keys of somebody stopped before this existed are not touched until that
 * account is next suspended or removed.
 */
import { apiKeysRepo, type ApiKey, type MetaDb, type User } from '@adminium/meta';

/** Run inside the transaction that stops the account. Answers the keys it revoked. */
export async function revokeAccountKeys(inTransaction: MetaDb, userId: string, at: number): Promise<ApiKey[]> {
  const keys = apiKeysRepo(inTransaction);
  const revoked = await keys.unrevokedBy(userId);
  await keys.revokeAllBy(userId, at);
  return revoked;
}

/** The entries the audit log keeps of it, each naming who made the key. */
export function accountKeyAuditEntries(creator: Pick<User, 'id' | 'email' | 'name'>, revoked: readonly ApiKey[]): { category: 'system'; action: string; changes: { before: Record<string, unknown>; after: Record<string, unknown> } }[] {
  return revoked.map((key) => ({
    category: 'system' as const,
    action: 'api-key.revoke',
    changes: {
      before: { apiKeyId: key.id, name: key.name, prefix: key.prefix, roleId: key.roleId, createdBy: creator.id, createdByEmail: creator.email, createdByName: creator.name },
      after: { reason: 'creator-stopped' },
    },
  }));
}
