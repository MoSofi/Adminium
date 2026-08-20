// SPDX-License-Identifier: AGPL-3.0-only
/**
 * publicScopesRepo + publicKeysRepo (28-public-surface.md §3.2–§3.3).
 *
 * Two behaviours here are policy rather than plumbing, and both have a comment
 * in the repo explaining why: `findByPrefix` returns EVERY candidate (the caller
 * compares hashes in constant time, so filtering on the hash in SQL would hand
 * the timing signal back to the database), and `remove` refuses while a key
 * still points at the scope (the FK is `restrict`; surfacing it as `false`
 * rather than a driver error is what lets the operator see what they are about
 * to break).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  connectionsRepo,
  publicKeysRepo,
  publicScopesRepo,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

/** Reversible stand-in; this suite never asserts on ciphertext. */
const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const T0 = 1_750_000_000_000;

const DOC = JSON.stringify({
  version: 1,
  side: 'customer',
  timezone: 'Europe/London',
  resources: [{ ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id'] }],
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`publicScopesRepo + publicKeysRepo [${dialect.name}]`, () => {
    let t: TestDb;
    let connectionId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      // The scope FK is `cascade` on the connection, so a real row is needed.
      const conn = await connectionsRepo(t.meta, testCrypto).create({
        name: 'src',
        engine: 'postgres',
        introspectDsn: 'postgres://ro:s@db/prod',
        dataDsn: 'postgres://rw:s@db/prod',
      });
      connectionId = conn.id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    async function seedScope() {
      return publicScopesRepo(t.meta).create(
        {
          connectionId,
          side: 'customer',
          name: 'portal',
          timezone: 'Europe/London',
          document: DOC,
        },
        T0,
      );
    }

    async function seedKey(scopeId: string, prefix = 'adm_pub_aaaaaaaa') {
      return publicKeysRepo(t.meta).create(
        {
          name: 'web',
          prefix,
          tokenHash: 'h'.repeat(64),
          tokenEncrypted: 'sealed',
          scopeId,
          side: 'customer',
        },
        T0,
      );
    }

    it('creates and reads a scope, stamping both timestamps', async () => {
      const scope = await seedScope();
      expect(scope.id).toMatch(/^psc_/);
      expect(scope.timezone).toBe('Europe/London');
      expect(scope.createdAt).toBe(T0);
      expect(scope.updatedAt).toBe(T0);
      expect(scope.proposedFromManifest).toBeNull();

      const found = await publicScopesRepo(t.meta).findById(scope.id);
      // COMPARED AS JSON, NOT AS TEXT, and the difference is the storage's to
      // make. `document` is a `json` column, which postgres stores as `jsonb` —
      // it keeps the VALUE and not the bytes, so the keys come back ordered by
      // length rather than as authored. Asserting the original string passed on
      // sqlite (which stores the text) and failed on postgres and mysql. What
      // every caller actually needs is that it parses to the same document, and
      // that it arrives as a STRING at all: `resolve.ts` calls `JSON.parse` on
      // it and the admin route returns it under a `z.string()` schema, both of
      // which broke on the two production stores until the repo normalised it.
      expect(typeof found?.document).toBe('string');
      expect(JSON.parse(found?.document ?? 'null')).toEqual(JSON.parse(DOC));
      expect(await publicScopesRepo(t.meta).findById('psc_nope')).toBeNull();
    });

    it('lists scopes for a connection', async () => {
      await seedScope();
      await seedScope();
      expect(await publicScopesRepo(t.meta).listByConnection(connectionId)).toHaveLength(2);
      expect(await publicScopesRepo(t.meta).listByConnection('conn_other')).toEqual([]);
    });

    it('updates a scope and moves updatedAt', async () => {
      const scope = await seedScope();
      expect(await publicScopesRepo(t.meta).update(scope.id, { name: 'renamed' }, T0 + 5)).toBe(true);
      const after = await publicScopesRepo(t.meta).findById(scope.id);
      expect(after?.name).toBe('renamed');
      expect(after?.updatedAt).toBe(T0 + 5);
      expect(await publicScopesRepo(t.meta).update('psc_nope', { name: 'x' })).toBe(false);
    });

    it('refuses to delete a scope while a key still points at it', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);

      expect(await publicScopesRepo(t.meta).remove(scope.id)).toBe(false);
      expect(await publicScopesRepo(t.meta).findById(scope.id)).not.toBeNull();

      // Revoking is not enough — the row still references it. Deleting the key
      // is, which is the order that makes the operator see the consequence.
      await publicKeysRepo(t.meta).revoke(key.id);
      expect(await publicScopesRepo(t.meta).remove(scope.id)).toBe(false);

      await t.meta.db.deleteFrom('adminium_public_keys').where('id', '=', key.id).execute();
      expect(await publicScopesRepo(t.meta).remove(scope.id)).toBe(true);
      expect(await publicScopesRepo(t.meta).findById(scope.id)).toBeNull();
    });

    it('creates a key with an empty origin list and a sealed secret', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      expect(key.id).toMatch(/^pbk_/);
      expect(key.origins).toBe('[]');
      expect(key.tokenEncrypted).toBe('sealed');
      expect(key.revokedAt).toBeNull();
      expect(key.lastUsedAt).toBeNull();
    });

    it('returns EVERY prefix candidate, so the caller can compare in constant time', async () => {
      const scope = await seedScope();
      await publicKeysRepo(t.meta).create(
        { name: 'a', prefix: 'adm_pub_dupe', tokenHash: 'a'.repeat(64), tokenEncrypted: 's', scopeId: scope.id, side: 'customer' },
        T0,
      );
      await publicKeysRepo(t.meta).create(
        { name: 'b', prefix: 'adm_pub_dupe', tokenHash: 'b'.repeat(64), tokenEncrypted: 's', scopeId: scope.id, side: 'customer' },
        T0,
      );
      // Both, not "the one whose hash matches" — the hash never reaches SQL.
      expect(await publicKeysRepo(t.meta).findByPrefix('adm_pub_dupe')).toHaveLength(2);
      expect(await publicKeysRepo(t.meta).findByPrefix('adm_pub_none')).toEqual([]);
    });

    it('finds by id, lists, and lists by scope', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      expect((await publicKeysRepo(t.meta).findById(key.id))?.name).toBe('web');
      expect(await publicKeysRepo(t.meta).findById('pbk_nope')).toBeNull();
      expect(await publicKeysRepo(t.meta).list()).toHaveLength(1);
      expect(await publicKeysRepo(t.meta).listByScope(scope.id)).toHaveLength(1);
      expect(await publicKeysRepo(t.meta).listByScope('psc_other')).toEqual([]);
    });

    it('rotates a live key in place, keeping its scope and origins', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      const ok = await publicKeysRepo(t.meta).rotate(
        key.id,
        { prefix: 'adm_pub_bbbbbbbb', tokenHash: 'z'.repeat(64), tokenEncrypted: 'sealed2' },
        T0 + 9,
      );
      expect(ok).toBe(true);
      const after = await publicKeysRepo(t.meta).findById(key.id);
      expect(after?.prefix).toBe('adm_pub_bbbbbbbb');
      expect(after?.scopeId).toBe(scope.id);
      expect(after?.updatedAt).toBe(T0 + 9);
    });

    it('will not rotate a revoked key back into service', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      await publicKeysRepo(t.meta).revoke(key.id, T0 + 1);
      expect(
        await publicKeysRepo(t.meta).rotate(key.id, {
          prefix: 'adm_pub_cccccccc',
          tokenHash: 'y'.repeat(64),
          tokenEncrypted: 's',
        }),
      ).toBe(false);
    });

    it('revokes once and only once', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      expect(await publicKeysRepo(t.meta).revoke(key.id, T0 + 1)).toBe(true);
      // A second revoke is not an error and not a second write.
      expect(await publicKeysRepo(t.meta).revoke(key.id, T0 + 2)).toBe(false);
      expect((await publicKeysRepo(t.meta).findById(key.id))?.revokedAt).toBe(T0 + 1);
    });

    it('touches lastUsedAt', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      await publicKeysRepo(t.meta).touchLastUsed(key.id, T0 + 3);
      expect((await publicKeysRepo(t.meta).findById(key.id))?.lastUsedAt).toBe(T0 + 3);
    });

    it('cascades keys away when the connection goes', async () => {
      // The scope FK is `cascade` on the connection and the key FK is
      // `restrict` on the scope — so deleting the connection must still clear
      // both rather than deadlocking on the restrict.
      const scope = await seedScope();
      await seedKey(scope.id);
      await t.meta.db.deleteFrom('adminium_public_keys').execute();
      await t.meta.db.deleteFrom('adminium_connections').where('id', '=', connectionId).execute();
      expect(await publicScopesRepo(t.meta).findById(scope.id)).toBeNull();
    });
  });
}
