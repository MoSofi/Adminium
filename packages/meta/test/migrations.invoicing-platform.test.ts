// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0044 (`invoicing_platform`) and its repos, on every available dialect.
 *
 * What predates the wave reads as it always was: a table built on nothing, a
 * code with no link, a profile no app owns, a document with nothing to reuse.
 * Then what the new columns are for: a table remembers the shape it was built
 * on and the columns that shape owns; a sign-in link is found by its token's
 * hash; an app's profiles are listed and removed without touching an
 * operator's; a rendered document is reused only on its own connection, and
 * only while it stands. Bounded columns are written at their full width,
 * since only postgres and mysql enforce one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  appTablesRepo,
  applyMigrations,
  connectionsRepo,
  documentProfilesRepo,
  documentsRepo,
  publicChallengesRepo,
  publicKeysRepo,
  publicScopesRepo,
  type DsnCrypto,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb, type TestDb } from './helpers/db.js';

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const T0 = 1_750_000_000_000;
const PRE_0044 = ALL_MIGRATIONS.filter((m) => m.name < '0044_invoicing_platform');

async function connection(meta: MetaDb, name = 'src'): Promise<string> {
  const conn = await connectionsRepo(meta, crypto).create({
    name,
    engine: 'postgres',
    introspectDsn: `postgres://ro:s@db/${name}`,
    dataDsn: `postgres://rw:s@db/${name}`,
  });
  return conn.id;
}

async function key(meta: MetaDb, connectionId: string): Promise<string> {
  const scope = await publicScopesRepo(meta).create(
    { connectionId, side: 'customer', name: 'studio', timezone: 'Europe/London', document: '{"version":1,"resources":[]}' },
    T0,
  );
  const row = await publicKeysRepo(meta).create(
    { name: 'web', prefix: 'adm_pub_studio01', tokenHash: 'h'.repeat(64), tokenEncrypted: 'sealed', scopeId: scope.id, side: 'customer', appKey: 'studio' },
    T0,
  );
  return row.id;
}

const profileInput = (connectionId: string, name: string, ownerApp: string | null) => ({
  addOnKey: 'invoices',
  kind: 'invoice',
  name,
  connectionId,
  table: 'public.studio_invoices',
  mapping: { number: { column: 'number' } },
  ...(ownerApp === null ? {} : { ownerApp, orderBy: 'p'.repeat(128) }),
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0044_invoicing_platform [${dialect.name}]`, () => {
    describe('before and after the wave', () => {
      let t: TestDb;
      beforeEach(async () => {
        t = await dialect.make();
      });
      afterEach(async () => {
        await t.destroy();
      });

      it('reads every older row as what it was', async () => {
        const m = t.meta;
        expect(PRE_0044.at(-1)?.name).toBe('0043_roles_namespace');
        await applyMigrations(m.db, { dialect: m.dialect, migrations: PRE_0044 });
        const connectionId = await connection(m);
        const keyId = await key(m, connectionId);
        // Raw inserts: today's repos write columns this schema does not have yet.
        await m.db
          .insertInto('adminium_app_tables')
          .values({ id: 'atb_pre0044', appKey: 'studio', manifestId: null, connectionId, ref: 'invoices', tableName: 'studio_invoices', schemaName: null, owned: 1, state: 'created', role: 'app', prefix: 'studio_', shape: null, rules: null, createdAt: T0, updatedAt: T0, releasedAt: null } as never)
          .execute();
        await m.db
          .insertInto('adminium_public_challenges')
          .values({ id: 'pch_pre0044', keyId, ref: 'clients', destinationHash: 'd', codeHash: 'c', attempts: 0, consumedAt: null, expiresAt: T0 + 60_000, createdAt: T0, purpose: 'verify' } as never)
          .execute();
        await m.db
          .insertInto('adminium_document_profiles')
          .values({ id: 'dpf_pre0044', addOnKey: 'invoices', kind: 'invoice', name: 'Invoice', connectionId, table: 'public.orders', mapping: '{}', options: '{}', trigger: null, deliver: '{"store":true}', enabled: 1, createdBy: null, createdAt: T0, updatedAt: T0 } as never)
          .execute();
        await m.db
          .insertInto('adminium_documents')
          .values({ id: 'doc_pre0044', profileId: 'dpf_pre0044', addOnKey: 'invoices', kind: 'invoice', connectionId, entity: null, entityTable: null, entityId: null, subject: '{}', number: null, fileId: null, htmlFileId: null, locale: 'en-US', format: 'pdf', status: 'rendered', error: null, delivery: null, sentAt: null, jobId: null, requestedBy: null, actorKind: 'system', claim: null, renderedAt: T0, voidedAt: null, voidReason: null, createdAt: T0 } as never)
          .execute();

        await applyMigrations(m.db, { dialect: m.dialect });

        expect(await appTablesRepo(m).find(connectionId, 'studio', 'invoices')).toMatchObject({ builtOn: null, shapeColumns: [] });
        expect(await publicChallengesRepo(m).findById('pch_pre0044')).toMatchObject({ tokenHash: null });
        expect(await documentProfilesRepo(m).findById('dpf_pre0044')).toMatchObject({ ownerApp: null, orderBy: null });
        expect(await documentsRepo(m).findById('doc_pre0044')).toMatchObject({ reuseKey: null });
      });
    });

    describe('the repos', () => {
      const meta = useMetaDb(dialect, migrateOnly);

      it('remember the shape a table is built on and the columns it owns, and keep them on a later record', async () => {
        const m = meta();
        const connectionId = await connection(m);
        const tables = appTablesRepo(m);
        const builtOn = `${'i'.repeat(80)}/${'invoice'.repeat(10)}@1#document`.slice(0, 160); // the full 160
        const record = await tables.record(
          { appKey: 'studio', manifestId: null, connectionId, ref: 'invoices', tableName: 'studio_invoices', owned: true, state: 'created', builtOn, shapeColumns: ['number_seq', 'number', 'total'] },
          T0,
        );
        expect(record).toMatchObject({ builtOn, shapeColumns: ['number_seq', 'number', 'total'] });
        // A resumed install that says nothing of the shape keeps what was recorded.
        const again = await tables.record({ appKey: 'studio', manifestId: null, connectionId, ref: 'invoices', tableName: 'studio_invoices', owned: true, state: 'created' }, T0 + 1);
        expect(again).toMatchObject({ builtOn, shapeColumns: ['number_seq', 'number', 'total'] });
        const cleared = await tables.record({ appKey: 'studio', manifestId: null, connectionId, ref: 'invoices', tableName: 'studio_invoices', owned: true, state: 'created', builtOn: null, shapeColumns: null }, T0 + 2);
        expect(cleared).toMatchObject({ builtOn: null, shapeColumns: [] });
      });

      it('finds a sign-in link by its token\'s hash, and never a code alone', async () => {
        const m = meta();
        const keyId = await key(m, await connection(m));
        const challenges = publicChallengesRepo(m);
        const base = { keyId, ref: 'clients', destinationHash: 'd'.repeat(64), codeHash: 'c'.repeat(64), expiresAt: T0 + 20 * 60_000, sessionId: null, purpose: 'link', subject: 'x'.repeat(64) };
        const link = await challenges.create({ ...base, tokenHash: 't'.repeat(64) }, T0);
        await challenges.create({ ...base, purpose: 'verify' }, T0);
        expect((await challenges.findByTokenHash('t'.repeat(64)))?.id).toBe(link.id);
        expect(await challenges.findByTokenHash('u'.repeat(64))).toBeNull();
        expect(link.tokenHash).toBe('t'.repeat(64));
      });

      it('lists and removes the profiles an app made, and leaves an operator\'s alone', async () => {
        const m = meta();
        const connectionId = await connection(m);
        const other = await connection(m, 'other');
        const profiles = documentProfilesRepo(m);
        const owned = await profiles.create(profileInput(connectionId, 'Invoice', 'studio'), T0);
        await profiles.create(profileInput(connectionId, 'Operator invoice', null), T0);
        await profiles.create(profileInput(other, 'Invoice', 'studio'), T0);
        expect(owned).toMatchObject({ ownerApp: 'studio', orderBy: 'p'.repeat(128) });
        expect((await profiles.listOwnedBy(connectionId, 'studio')).map((p) => p.id)).toEqual([owned.id]);
        expect(await profiles.removeOwnedBy(connectionId, 'studio')).toBe(1);
        expect((await profiles.list({ connectionId })).map((p) => p.name)).toEqual(['Operator invoice']);
        expect(await profiles.listOwnedBy(other, 'studio')).toHaveLength(1);
      });

      it('reuses a rendered document only on its own connection, only while it stands', async () => {
        const m = meta();
        const connectionId = await connection(m);
        const other = await connection(m, 'other');
        const documents = documentsRepo(m);
        const reuseKey = 'r'.repeat(191); // the full 191
        const doc = (conn: string, at: number) =>
          documents.create({ profileId: null, addOnKey: 'invoices', kind: 'invoice', connectionId: conn, entity: null, subject: {}, locale: 'en-US', format: 'pdf', reuseKey }, at);
        const first = await doc(connectionId, T0);
        // Not rendered yet: nothing to reuse.
        expect(await documents.findReusable(connectionId, reuseKey)).toBeNull();
        await documents.markRendered(first.id, { number: null, fileId: null, htmlFileId: null, format: 'pdf' }, T0 + 1);
        const second = await doc(connectionId, T0 + 2);
        await documents.markRendered(second.id, { number: null, fileId: null, htmlFileId: null, format: 'pdf' }, T0 + 3);
        expect((await documents.findReusable(connectionId, reuseKey))?.id).toBe(second.id);
        expect(await documents.findReusable(other, reuseKey)).toBeNull();
        await documents.markVoided(second.id, 'replaced', T0 + 4);
        expect((await documents.findReusable(connectionId, reuseKey))?.id).toBe(first.id);
      });
    });
  });
}
