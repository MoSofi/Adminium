// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0038: public endpoints, derived scopes, server keys, request
 * counts and the revision, on every available dialect.
 *
 * What each case holds, and why it is here rather than on sqlite alone:
 *
 * - A released install upgrades, and the rows 0014 wrote still read — keys
 *   default to `browser`, carry no `access`, and scopes are not derived.
 * - A derived scope and its key are written in the order the design needs
 *   (scope first, naming a key id minted up front). With a foreign key back to
 *   the key this could not be inserted at all.
 * - JSON columns read back as TEXT. Postgres and MySQL hand the driver a parsed
 *   value, and two shipped readers broke on it. Only those
 *   dialects can show it.
 * - Request counts ADD, including when the hour's row does not exist yet.
 * - The revision's compare-and-set refuses a stale expected value.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  clearInertPublicKeys,
  connectionsRepo,
  newId,
  publicApiStateRepo,
  publicEndpointsRepo,
  publicKeysRepo,
  publicRequestStatsRepo,
  publicScopesRepo,
  publicSessionsRepo,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const HOUR = 3_600_000;
const PRE_0038 = ALL_MIGRATIONS.filter((m) => m.name < '0038_public_endpoints');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };

async function connection(meta: MetaDb): Promise<string> {
  const row = await connectionsRepo(meta, crypto).create({
    name: 'Shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@db.internal:5432/shop',
  });
  return row.id;
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0038_public_endpoints [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    const migrateAll = () => applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

    it('upgrades a released install, and the rows 0014 wrote still read', async () => {
      expect(PRE_0038.at(-1)?.name).toBe('0037_manifest_package_integrity');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0038 });
      const connectionId = await connection(t.meta);

      // Written with the columns 0014 knew about and nothing else.
      const scopeId = newId('psc');
      await t.meta.db
        .insertInto('adminium_public_scopes')
        .values({
          id: scopeId,
          connectionId,
          side: 'customer',
          name: 'storefront',
          timezone: 'UTC',
          document: JSON.stringify({ version: 1, side: 'customer', resources: [] }),
          proposedFromManifest: null,
          createdBy: null,
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();
      const keyId = newId('pbk');
      await t.meta.db
        .insertInto('adminium_public_keys')
        .values({
          id: keyId,
          name: 'web',
          prefix: 'adm_pub_aaaaaaaa',
          tokenHash: 'h'.repeat(64),
          tokenEncrypted: 'sealed',
          scopeId,
          side: 'customer',
          appKey: null,
          origins: JSON.stringify(['https://shop.example.com']),
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdBy: null,
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();

      await migrateAll();

      const key = await publicKeysRepo(t.meta).findById(keyId);
      expect(key?.kind).toBe('browser');
      expect(key?.access).toBeNull();
      expect(key?.origins).toBe('["https://shop.example.com"]');
      const scope = await publicScopesRepo(t.meta).findById(scopeId);
      expect(scope?.derivedForKey).toBeNull();
      expect(JSON.parse(scope?.document ?? 'null')).toEqual({ version: 1, side: 'customer', resources: [] });
    });

    it('writes a derived scope before its key, one per key', async () => {
      await migrateAll();
      const connectionId = await connection(t.meta);
      const scopes = publicScopesRepo(t.meta);
      const keys = publicKeysRepo(t.meta);

      const keyId = newId('pbk');
      const derived = await scopes.create({
        connectionId,
        side: 'customer',
        name: 'web',
        timezone: 'UTC',
        document: '{}',
        derivedForKey: keyId,
      });
      const key = await keys.create({
        id: keyId,
        name: 'web',
        prefix: 'adm_pub_bbbbbbbb',
        tokenHash: 'k'.repeat(64),
        tokenEncrypted: 'sealed',
        scopeId: derived.id,
        side: 'customer',
        access: { pep_1: ['GET', 'POST'] },
        kind: 'server',
      });
      expect(key.id).toBe(keyId);
      expect((await scopes.findById(derived.id))?.derivedForKey).toBe(keyId);
      const read = await keys.findById(keyId);
      expect(read?.kind).toBe('server');
      expect(read?.access).toBe('{"pep_1":["GET","POST"]}');

      // One derived scope per key…
      await expect(
        scopes.create({ connectionId, side: 'customer', name: 'again', timezone: 'UTC', document: '{}', derivedForKey: keyId }),
      ).rejects.toThrow();
      // …and any number of hand-written ones, whose column is NULL.
      await scopes.create({ connectionId, side: 'customer', name: 'a', timezone: 'UTC', document: '{}' });
      await scopes.create({ connectionId, side: 'customer', name: 'b', timezone: 'UTC', document: '{}' });
    });

    it('reads every public JSON column back as text', async () => {
      await migrateAll();
      const connectionId = await connection(t.meta);
      const scope = await publicScopesRepo(t.meta).create({
        connectionId,
        side: 'customer',
        name: 's',
        timezone: 'UTC',
        document: '{}',
      });
      const keys = publicKeysRepo(t.meta);
      const key = await keys.create({
        name: 'k',
        prefix: 'adm_pub_cccccccc',
        tokenHash: 'c'.repeat(64),
        tokenEncrypted: 'sealed',
        scopeId: scope.id,
        side: 'customer',
        origins: ['https://shop.example.com'],
        access: { pep_1: ['GET'] },
        appKey: 'clinic',
      });

      // Every read path: the resolver's, the admin DTO's, and the hosted
      // surface's. The resolver `JSON.parse`s `origins`; a parsed array there
      // threw and silently dropped the key's origin narrowing.
      const [byPrefix] = await keys.findByPrefix('adm_pub_cccccccc');
      for (const row of [
        byPrefix,
        await keys.findById(key.id),
        (await keys.list())[0],
        (await keys.listByScope(scope.id))[0],
        await keys.newestLiveByApp('clinic', 'customer'),
        await keys.newestLiveByAppAndConnection('clinic', 'customer', connectionId),
      ]) {
        expect(typeof row?.origins).toBe('string');
        expect(JSON.parse(row?.origins ?? 'null')).toEqual(['https://shop.example.com']);
        expect(JSON.parse(row?.access ?? 'null')).toEqual({ pep_1: ['GET'] });
      }

      // A claimed session's grant: `parseGrant` failed on the parsed object and
      // the session was ignored, so claim-gated resources 404'd.
      const grant = { ref: 'orders', column: 'customer_id', value: 41 };
      await publicSessionsRepo(t.meta).create({
        keyId: key.id,
        tokenHash: 's'.repeat(64),
        grants: JSON.stringify(grant),
        expiresAt: T0 * 2,
      });
      const session = await publicSessionsRepo(t.meta).findValid('s'.repeat(64), T0);
      expect(typeof session?.grants).toBe('string');
      expect(JSON.parse(session?.grants ?? 'null')).toEqual(grant);
    });

    it('stores endpoints once per ref, and reads the definition back byte for byte', async () => {
      await migrateAll();
      const connectionId = await connection(t.meta);
      const endpoints = publicEndpointsRepo(t.meta);
      // Key order the store must not touch: `jsonb` would sort these.
      const definition = '{\n  "path": "/orders",\n  "source": "public.orders",\n  "methods": ["GET"]\n}';

      const stored = await endpoints.create({ connectionId, ref: 'orders', origin: 'generated', definition }, T0);
      expect(stored.id.startsWith('pep_')).toBe(true);
      expect((await endpoints.findByRef(connectionId, 'orders'))?.definition).toBe(definition);

      await expect(
        endpoints.create({ connectionId, ref: 'orders', origin: 'custom', definition: '{}' }),
      ).rejects.toThrow();
      // The race a key create's materialize step runs: the loser gets the winner's row.
      const again = await endpoints.createOrGet({ connectionId, ref: 'orders', origin: 'generated', definition: '{}' });
      expect(again.id).toBe(stored.id);

      expect(await endpoints.update(stored.id, { definition: '{"methods":[]}' }, T0 + 1)).toBe(true);
      expect((await endpoints.findById(stored.id))?.definition).toBe('{"methods":[]}');
      await endpoints.create({ connectionId, ref: 'customers', origin: 'custom', definition: '{}' });
      expect((await endpoints.listByConnection(connectionId)).map((e) => e.ref)).toEqual(['customers', 'orders']);
      expect(await endpoints.remove(stored.id)).toBe(true);
      expect(await endpoints.findById(stored.id)).toBeNull();
    });

    it('goes with its connection', async () => {
      await migrateAll();
      const connectionId = await connection(t.meta);
      const endpoints = publicEndpointsRepo(t.meta);
      await endpoints.create({ connectionId, ref: 'orders', origin: 'custom', definition: '{}' });
      await connectionsRepo(t.meta, crypto).delete(connectionId);
      expect(await endpoints.listByConnection(connectionId)).toEqual([]);
    });

    it('adds request counts, sums them, and purges old hours', async () => {
      await migrateAll();
      const stats = publicRequestStatsRepo(t.meta);
      const hour = T0 - (T0 % HOUR);

      // The first write to an hour inserts; every later one adds.
      await stats.add({ keyId: 'pbk_a', ref: 'orders', bucket: hour, requests: 3, errors: 1 });
      await stats.add({ keyId: 'pbk_a', ref: 'orders', bucket: hour, requests: 4, errors: 0 });
      await stats.add({ keyId: 'pbk_a', ref: 'menu', bucket: hour, requests: 2, errors: 0 });
      await stats.add({ keyId: 'pbk_b', ref: 'orders', bucket: hour - 48 * HOUR, requests: 9, errors: 9 });

      expect(await stats.totals({ since: hour - 23 * HOUR })).toEqual({ requests: 9, errors: 1 });
      expect(await stats.totals({ since: 0, keyIds: ['pbk_b'] })).toEqual({ requests: 9, errors: 9 });
      expect(await stats.totals({ since: 0, keyIds: [] })).toEqual({ requests: 0, errors: 0 });
      expect(await stats.totals({ since: hour + HOUR })).toEqual({ requests: 0, errors: 0 });

      expect(await stats.purgeBefore(hour - 24 * HOUR)).toBe(1);
      expect(await stats.totals({ since: 0 })).toEqual({ requests: 9, errors: 1 });
    });

    it("clearing an inert key clears its request counts", async () => {
      await migrateAll();
      const connectionId = await connection(t.meta);
      const scope = await publicScopesRepo(t.meta).create({
        connectionId,
        side: 'customer',
        name: 's',
        timezone: 'UTC',
        document: '{}',
      });
      const keys = publicKeysRepo(t.meta);
      const key = await keys.create({
        name: 'k',
        prefix: 'adm_pub_dddddddd',
        tokenHash: 'd'.repeat(64),
        tokenEncrypted: 'sealed',
        scopeId: scope.id,
        side: 'customer',
      });
      await keys.revoke(key.id, T0);
      const stats = publicRequestStatsRepo(t.meta);
      await stats.add({ keyId: key.id, ref: 'orders', bucket: T0, requests: 5, errors: 0 });

      await t.meta.db.transaction().execute((trx) => clearInertPublicKeys(trx, { scopeId: scope.id }, T0 + 1));
      expect(await keys.findById(key.id)).toBeNull();
      expect(await stats.totals({ since: 0 })).toEqual({ requests: 0, errors: 0 });
    });

    it('advances the revision, and refuses a stale compare-and-set', async () => {
      await migrateAll();
      const state = publicApiStateRepo(t.meta);
      expect(await state.read()).toBe(0);

      // Before any row exists, advancing from 0 creates it.
      expect(await state.advanceFrom(0, T0)).toBe(true);
      expect(await state.read()).toBe(1);
      expect(await state.advanceFrom(0, T0)).toBe(false);

      await state.ensure(T0);
      await state.bump(T0);
      expect(await state.read()).toBe(2);
      expect(await state.advanceFrom(2, T0)).toBe(true);
      // Two saves that both read 3: the first wins, the second derives again.
      expect(await state.advanceFrom(3, T0)).toBe(true);
      expect(await state.advanceFrom(3, T0)).toBe(false);
      expect(await state.read()).toBe(4);

      await t.meta.db.transaction().execute((trx) => state.bump(T0, trx));
      expect(await state.read()).toBe(5);
    });

    it('bump creates the row when nothing has yet', async () => {
      await migrateAll();
      const state = publicApiStateRepo(t.meta);
      await state.bump(T0);
      expect(await state.read()).toBe(1);
      await state.ensure(T0);
      expect(await state.read()).toBe(1);
    });
  });
}
