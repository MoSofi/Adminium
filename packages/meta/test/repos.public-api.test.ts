// SPDX-License-Identifier: AGPL-3.0-only
/**
 * publicScopesRepo + publicKeysRepo.
 *
 * Two behaviours here are policy rather than plumbing, and both have a comment
 * in the repo explaining why: `findByPrefix` returns EVERY candidate (the caller
 * compares hashes in constant time, so filtering on the hash in SQL would hand
 * the timing signal back to the database), and `remove` refuses while a LIVE
 * key still points at the scope (the FK is `restrict`; a typed
 * `LivePublicKeysError` rather than a driver error is what lets the operator
 * see what they are about to break). Revoked and expired keys go with it.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  LivePublicKeysError,
  connectionsRepo,
  publicKeysRepo,
  publicScopesRepo,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

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
    const meta = useMetaDb(dialect, migrateOnly);
    let connectionId: string;

    beforeEach(async () => {
      // The scope FK is `cascade` on the connection, so a real row is needed.
      const conn = await connectionsRepo(meta(), testCrypto).create({
        name: 'src',
        engine: 'postgres',
        introspectDsn: 'postgres://ro:s@db/prod',
        dataDsn: 'postgres://rw:s@db/prod',
      });
      connectionId = conn.id;
    });

    async function seedScope() {
      return publicScopesRepo(meta()).create(
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
      return publicKeysRepo(meta()).create(
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

    /** A key bound to a hosted app surface (0017). */
    async function seedBoundKey(
      scopeId: string,
      opts: { prefix: string; appKey?: string; expiresAt?: number | null; at?: number },
    ) {
      return publicKeysRepo(meta()).create(
        {
          name: `bound ${opts.prefix}`,
          prefix: opts.prefix,
          tokenHash: 'h'.repeat(64),
          tokenEncrypted: `sealed:${opts.prefix}`,
          scopeId,
          side: 'customer',
          appKey: opts.appKey ?? 'clients',
          expiresAt: opts.expiresAt ?? null,
        },
        opts.at ?? T0,
      );
    }

    it('stores the app binding and defaults it to null (0017)', async () => {
      const scope = await seedScope();
      const unbound = await seedKey(scope.id);
      expect(unbound.appKey).toBeNull();
      const bound = await seedBoundKey(scope.id, { prefix: 'adm_pub_bound001' });
      expect((await publicKeysRepo(meta()).findById(bound.id))?.appKey).toBe('clients');
    });

    it('newestLiveByApp picks the newest key that is neither revoked nor expired', async () => {
      const scope = await seedScope();
      const repo = publicKeysRepo(meta());
      const older = await seedBoundKey(scope.id, { prefix: 'adm_pub_older000', at: T0 });
      const newer = await seedBoundKey(scope.id, { prefix: 'adm_pub_newer000', at: T0 + 1000 });
      // Wrong side, wrong app, expired, revoked — none of these may ever win.
      await repo.create(
        {
          name: 'staff-side',
          prefix: 'adm_pub_staffkey',
          tokenHash: 'h'.repeat(64),
          tokenEncrypted: 'sealed',
          scopeId: scope.id,
          side: 'staff',
          appKey: 'clients',
        },
        T0 + 5000,
      );
      await seedBoundKey(scope.id, { prefix: 'adm_pub_otherapp', appKey: 'clinic', at: T0 + 5000 });
      await seedBoundKey(scope.id, {
        prefix: 'adm_pub_expired0',
        expiresAt: T0 + 1,
        at: T0 + 5000,
      });

      expect((await repo.newestLiveByApp('clients', 'customer', T0 + 9000))?.id).toBe(newer.id);
      // Revoking the newest falls back to the next live key — the staged-
      // replacement order the repo comment promises.
      await repo.revoke(newer.id, T0 + 9000);
      expect((await repo.newestLiveByApp('clients', 'customer', T0 + 9000))?.id).toBe(older.id);
      await repo.revoke(older.id, T0 + 9000);
      expect(await repo.newestLiveByApp('clients', 'customer', T0 + 9000)).toBeNull();
      expect(await repo.newestLiveByApp('unknown', 'customer', T0 + 9000)).toBeNull();
    });

    it('rotation keeps the app binding (29 acceptance criterion 9)', async () => {
      const scope = await seedScope();
      const key = await seedBoundKey(scope.id, { prefix: 'adm_pub_rotate00' });
      await publicKeysRepo(meta()).rotate(key.id, {
        prefix: 'adm_pub_rotate11',
        tokenHash: 'i'.repeat(64),
        tokenEncrypted: 'sealed:next',
      });
      const after = await publicKeysRepo(meta()).findById(key.id);
      expect(after?.appKey).toBe('clients');
      expect(after?.prefix).toBe('adm_pub_rotate11');
    });

    it('creates and reads a scope, stamping both timestamps', async () => {
      const scope = await seedScope();
      expect(scope.id).toMatch(/^psc_/);
      expect(scope.timezone).toBe('Europe/London');
      expect(scope.createdAt).toBe(T0);
      expect(scope.updatedAt).toBe(T0);
      expect(scope.proposedFromManifest).toBeNull();

      const found = await publicScopesRepo(meta()).findById(scope.id);
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
      expect(await publicScopesRepo(meta()).findById('psc_nope')).toBeNull();
    });

    it('lists scopes for a connection', async () => {
      await seedScope();
      await seedScope();
      expect(await publicScopesRepo(meta()).listByConnection(connectionId)).toHaveLength(2);
      expect(await publicScopesRepo(meta()).listByConnection('conn_other')).toEqual([]);
    });

    it('updates a scope and moves updatedAt', async () => {
      const scope = await seedScope();
      expect(await publicScopesRepo(meta()).update(scope.id, { name: 'renamed' }, T0 + 5)).toBe(true);
      const after = await publicScopesRepo(meta()).findById(scope.id);
      expect(after?.name).toBe('renamed');
      expect(after?.updatedAt).toBe(T0 + 5);
      expect(await publicScopesRepo(meta()).update('psc_nope', { name: 'x' })).toBe(false);
    });

    it('refuses to delete a scope while a live key points at it, and clears it once revoked', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);

      const refusal = await publicScopesRepo(meta())
        .remove(scope.id)
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(LivePublicKeysError);
      expect((refusal as LivePublicKeysError).keys).toEqual([
        { id: key.id, name: 'web', prefix: 'adm_pub_aaaaaaaa', scopeId: scope.id },
      ]);
      expect(await publicScopesRepo(meta()).findById(scope.id)).not.toBeNull();

      // Revoking is enough: the revoked row breaks nothing, and nothing else
      // can remove it, so it goes with the scope. Before, it kept the scope
      // undeletable forever.
      await publicKeysRepo(meta()).revoke(key.id, T0 + 1);
      expect(await publicScopesRepo(meta()).remove(scope.id, T0 + 2)).toBe(true);
      expect(await publicScopesRepo(meta()).findById(scope.id)).toBeNull();
      expect(await publicKeysRepo(meta()).findById(key.id)).toBeNull();
    });

    it('leaves the other scopes\' keys alone when it clears one scope', async () => {
      const doomed = await seedScope();
      const kept = await seedScope();
      const revoked = await seedKey(doomed.id, 'adm_pub_doomed01');
      await publicKeysRepo(meta()).revoke(revoked.id, T0 + 1);
      const keptRevoked = await seedKey(kept.id, 'adm_pub_keptrev1');
      await publicKeysRepo(meta()).revoke(keptRevoked.id, T0 + 1);

      expect(await publicScopesRepo(meta()).remove(doomed.id, T0 + 2)).toBe(true);
      expect(await publicKeysRepo(meta()).findById(keptRevoked.id)).not.toBeNull();
      expect(await publicScopesRepo(meta()).findById(kept.id)).not.toBeNull();
    });

    it('lists the inert keys of a scope or a connection', async () => {
      const scope = await seedScope();
      const live = await seedKey(scope.id, 'adm_pub_live0001');
      const revoked = await seedKey(scope.id, 'adm_pub_revoked2');
      await publicKeysRepo(meta()).revoke(revoked.id, T0 + 1);

      const byScope = await publicKeysRepo(meta()).listInert({ scopeId: scope.id }, T0 + 2);
      const byConnection = await publicKeysRepo(meta()).listInert({ connectionId }, T0 + 2);
      expect(byScope.map((k) => k.id)).toEqual([revoked.id]);
      expect(byConnection.map((k) => k.id)).toEqual([revoked.id]);
      expect(byScope.some((k) => k.id === live.id)).toBe(false);
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
      await publicKeysRepo(meta()).create(
        { name: 'a', prefix: 'adm_pub_dupe', tokenHash: 'a'.repeat(64), tokenEncrypted: 's', scopeId: scope.id, side: 'customer' },
        T0,
      );
      await publicKeysRepo(meta()).create(
        { name: 'b', prefix: 'adm_pub_dupe', tokenHash: 'b'.repeat(64), tokenEncrypted: 's', scopeId: scope.id, side: 'customer' },
        T0,
      );
      // Both, not "the one whose hash matches" — the hash never reaches SQL.
      expect(await publicKeysRepo(meta()).findByPrefix('adm_pub_dupe')).toHaveLength(2);
      expect(await publicKeysRepo(meta()).findByPrefix('adm_pub_none')).toEqual([]);
    });

    it('finds by id, lists, and lists by scope', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      expect((await publicKeysRepo(meta()).findById(key.id))?.name).toBe('web');
      expect(await publicKeysRepo(meta()).findById('pbk_nope')).toBeNull();
      expect(await publicKeysRepo(meta()).list()).toHaveLength(1);
      expect(await publicKeysRepo(meta()).listByScope(scope.id)).toHaveLength(1);
      expect(await publicKeysRepo(meta()).listByScope('psc_other')).toEqual([]);
    });

    it('rotates a live key in place, keeping its scope and origins', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      const ok = await publicKeysRepo(meta()).rotate(
        key.id,
        { prefix: 'adm_pub_bbbbbbbb', tokenHash: 'z'.repeat(64), tokenEncrypted: 'sealed2' },
        T0 + 9,
      );
      expect(ok).toBe(true);
      const after = await publicKeysRepo(meta()).findById(key.id);
      expect(after?.prefix).toBe('adm_pub_bbbbbbbb');
      expect(after?.scopeId).toBe(scope.id);
      expect(after?.updatedAt).toBe(T0 + 9);
    });

    it('will not rotate a revoked key back into service', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      await publicKeysRepo(meta()).revoke(key.id, T0 + 1);
      expect(
        await publicKeysRepo(meta()).rotate(key.id, {
          prefix: 'adm_pub_cccccccc',
          tokenHash: 'y'.repeat(64),
          tokenEncrypted: 's',
        }),
      ).toBe(false);
    });

    it('revokes once and only once', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      expect(await publicKeysRepo(meta()).revoke(key.id, T0 + 1)).toBe(true);
      // A second revoke is not an error and not a second write.
      expect(await publicKeysRepo(meta()).revoke(key.id, T0 + 2)).toBe(false);
      expect((await publicKeysRepo(meta()).findById(key.id))?.revokedAt).toBe(T0 + 1);
    });

    it('touches lastUsedAt', async () => {
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      await publicKeysRepo(meta()).touchLastUsed(key.id, T0 + 3);
      expect((await publicKeysRepo(meta()).findById(key.id))?.lastUsedAt).toBe(T0 + 3);
    });

    it('never moves lastUsedAt backwards', async () => {
      // Each replica throttles on its own clock, so a write can arrive carrying
      // an older time than the one already stored.
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      await publicKeysRepo(meta()).touchLastUsed(key.id, T0 + 10);
      await publicKeysRepo(meta()).touchLastUsed(key.id, T0 + 5);
      expect((await publicKeysRepo(meta()).findById(key.id))?.lastUsedAt).toBe(T0 + 10);
      await publicKeysRepo(meta()).touchLastUsed(key.id, T0 + 20);
      expect((await publicKeysRepo(meta()).findById(key.id))?.lastUsedAt).toBe(T0 + 20);
    });

    it('deletes a connection whose scope once had a key', async () => {
      // The scope FK is `cascade` on the connection and the key FK is
      // `restrict` on the scope, so a bare DELETE of the connection dies on the
      // restrict (a 500 on a Postgres meta store in 0.3.0-rc.0). A revoked key
      // breaks nothing, and nothing else can remove its row, so the delete
      // clears it in the same transaction.
      const scope = await seedScope();
      const key = await seedKey(scope.id);
      await publicKeysRepo(meta()).revoke(key.id, T0 + 1);

      expect(await connectionsRepo(meta(), testCrypto).delete(connectionId)).toBe(true);
      expect(await connectionsRepo(meta(), testCrypto).findById(connectionId)).toBeNull();
      expect(await publicScopesRepo(meta()).findById(scope.id)).toBeNull();
      expect(await publicKeysRepo(meta()).findById(key.id)).toBeNull();
    });

    it('treats an expired key as inert too', async () => {
      const scope = await seedScope();
      const key = await publicKeysRepo(meta()).create(
        {
          name: 'old',
          prefix: 'adm_pub_expired1',
          tokenHash: 'h'.repeat(64),
          tokenEncrypted: 'sealed',
          scopeId: scope.id,
          side: 'customer',
          expiresAt: T0 + 1,
        },
        T0,
      );

      expect(await connectionsRepo(meta(), testCrypto).delete(connectionId, T0 + 2)).toBe(true);
      expect(await publicKeysRepo(meta()).findById(key.id)).toBeNull();
    });

    it('refuses to delete a connection while a live key would break', async () => {
      const scope = await seedScope();
      const live = await seedKey(scope.id, 'adm_pub_livekey1');
      const revoked = await seedKey(scope.id, 'adm_pub_revoked1');
      await publicKeysRepo(meta()).revoke(revoked.id, T0 + 1);

      const refusal = await connectionsRepo(meta(), testCrypto)
        .delete(connectionId, T0 + 2)
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(LivePublicKeysError);
      expect((refusal as LivePublicKeysError).keys).toEqual([
        { id: live.id, name: 'web', prefix: 'adm_pub_livekey1', scopeId: scope.id },
      ]);

      // Refused as a whole: the revoked row was not purged on the way out.
      expect(await connectionsRepo(meta(), testCrypto).findById(connectionId)).not.toBeNull();
      expect(await publicKeysRepo(meta()).findById(revoked.id)).not.toBeNull();
    });

    it('a hosted app is never served a server key, even the newest one', async () => {
      const scope = await seedScope();
      const repo = publicKeysRepo(meta());
      const browser = await repo.create(
        { name: 'web', prefix: 'adm_pub_browser1', tokenHash: 'h'.repeat(64), tokenEncrypted: 'sealed', scopeId: scope.id, side: 'customer', appKey: 'shop' },
        T0,
      );
      await repo.create(
        { name: 'srv', prefix: 'adm_srv_server01', tokenHash: 'i'.repeat(64), tokenEncrypted: '', scopeId: scope.id, side: 'customer', appKey: 'shop', kind: 'server' },
        T0 + 1,
      );
      expect((await repo.newestLiveByApp('shop', 'customer', T0 + 2))?.id).toBe(browser.id);
      expect((await repo.newestLiveByAppAndConnection('shop', 'customer', connectionId, T0 + 2))?.id).toBe(browser.id);
    });

    it('listLiveDerived: live keys over DERIVED scopes of this connection, with the document', async () => {
      const handWritten = await seedScope();
      await seedKey(handWritten.id, 'adm_pub_handwrit');
      const derivedDoc = JSON.stringify({ version: 1, side: 'customer', resources: [] });
      const make = async (id: string, prefix: string, extra: Record<string, unknown> = {}) => {
        // Written inside one transaction, scope first: the order a key create uses.
        await meta().db.transaction().execute(async (trx) => {
          const scope = await publicScopesRepo(meta()).create(
            { connectionId, side: 'customer', name: id, timezone: 'UTC', document: derivedDoc, derivedForKey: id },
            T0,
            trx,
          );
          await publicKeysRepo(meta()).create(
            {
              id,
              name: id,
              prefix,
              tokenHash: 'h'.repeat(64),
              tokenEncrypted: 'sealed',
              scopeId: scope.id,
              side: 'customer',
              access: { pep_a: ['GET'] },
              ...extra,
            },
            T0,
            trx,
          );
        });
      };
      await make('pbk_live1', 'adm_pub_derived1');
      await make('pbk_expired', 'adm_pub_derived2', { expiresAt: T0 + 5 });
      await make('pbk_revoked', 'adm_pub_derived3');
      await publicKeysRepo(meta()).revoke('pbk_revoked', T0 + 1);

      const live = await publicKeysRepo(meta()).listLiveDerived(connectionId, T0 + 10);
      expect(live.map((k) => k.id)).toEqual(['pbk_live1']);
      // Text on every store; key order is the store's (jsonb reorders), so compare parsed.
      expect(JSON.parse(live[0]?.scopeDocument ?? 'null')).toEqual(JSON.parse(derivedDoc));
      expect(JSON.parse(live[0]?.access ?? 'null')).toEqual({ pep_a: ['GET'] });
      // Before the expiry, the expiring key is live too.
      expect((await publicKeysRepo(meta()).listLiveDerived(connectionId, T0 + 1)).map((k) => k.id).sort()).toEqual([
        'pbk_expired',
        'pbk_live1',
      ]);

      // An update through a transaction lands with it.
      const scopeId = live[0]?.scopeId ?? '';
      await meta().db.transaction().execute(async (trx) => {
        expect(await publicScopesRepo(meta()).update(scopeId, { document: '{"v":2}' }, T0 + 3, trx)).toBe(true);
      });
      expect(JSON.parse((await publicScopesRepo(meta()).findById(scopeId))?.document ?? 'null')).toEqual({ v: 2 });
    });
  });
}
